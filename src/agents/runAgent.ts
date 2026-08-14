import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { eq } from 'drizzle-orm';
import pLimit from 'p-limit';
import { z } from 'zod';
import {
  AGENT_CONCURRENCY,
  DEFAULT_AGENT_BUDGET_USD,
  MAX_AGENT_CALLS_PER_RUN,
} from '../config/agents.ts';
import type { ModelId } from '../config/models.ts';
import { db } from '../db/client.ts';
import { agentCalls, runSteps, type ModelUsageEntry } from '../db/schema.ts';
import type { StepContext } from '../db/steps.ts';

/**
 * The single entry point for calling a model.
 *
 * Everything that must hold for every agent call is enforced here and nowhere
 * else: isolation from ambient settings, a typed and validated result, a bound
 * on how many calls are in flight, and a row in `agent_calls` recording what was
 * spent. Nothing else in the codebase should import the Agent SDK.
 */

export type AgentSpec<T> = {
  /** The agent task, recorded as `agent_calls.agent_name`, e.g. `triage`. */
  name: string;
  model: ModelId;
  systemPrompt: string;
  prompt: string;
  /**
   * The output contract, in one place. Converted to JSON Schema for the model
   * and used to validate what comes back.
   */
  schema: z.ZodType<T>;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  mcpServers?: Options['mcpServers'];
};

type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

/** The subscription quota is spent; no further call in this run can succeed. */
export class RateLimitExhaustedError extends Error {
  readonly resetsAt: Date | undefined;

  constructor(state: BreakerState) {
    const when = state.resetsAt ? `, resets at ${state.resetsAt.toISOString()}` : '';
    super(`rate limit exhausted (${state.reason ?? 'unknown'}${when})`);
    this.name = 'RateLimitExhaustedError';
    this.resetsAt = state.resetsAt;
  }
}

/** More calls in one run than any correct pipeline should make. */
export class AgentCallLimitError extends Error {
  constructor(runId: string, max: number) {
    super(`run ${runId} exceeded ${max} agent calls — check for a runaway fan-out`);
    this.name = 'AgentCallLimitError';
  }
}

/**
 * Concurrency is mutable rather than fixed at construction so a CLI flag can
 * resolve at startup, after this module has already been imported.
 */
const limit = pLimit(AGENT_CONCURRENCY);

export function setAgentConcurrency(concurrency: number): void {
  limit.concurrency = concurrency;
}

export function getAgentConcurrency(): number {
  return limit.concurrency;
}

type BreakerState = { tripped: boolean; reason?: string; resetsAt?: Date };

/**
 * Once the quota is spent, every remaining call in the run fails too. Stopping
 * immediately is better than grinding through them: `withStep` has preserved
 * everything already finished, so resuming after the window resets costs only
 * the work that never ran.
 */
let breaker: BreakerState = { tripped: false };

export function rateLimitBreakerState(): Readonly<BreakerState> {
  return breaker;
}

export function resetRateLimitBreaker(): void {
  breaker = { tripped: false };
}

function tripBreaker(reason: string, resetsAt?: number): void {
  if (breaker.tripped) return; // first signal wins; later ones add nothing
  breaker = { tripped: true, reason, ...(resetsAt ? { resetsAt: toDate(resetsAt) } : {}) };
}

/** The SDK's epoch unit is unspecified; seconds and milliseconds differ by ~1000x. */
function toDate(epoch: number): Date {
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch);
}

const callsPerRun = new Map<string, number>();
let maxCallsPerRun = MAX_AGENT_CALLS_PER_RUN;

export function setMaxAgentCallsPerRun(max: number): void {
  maxCallsPerRun = max;
}

export function resetAgentCallCounts(): void {
  callsPerRun.clear();
}

function countCall(runId: string): void {
  const total = (callsPerRun.get(runId) ?? 0) + 1;
  if (total > maxCallsPerRun) throw new AgentCallLimitError(runId, maxCallsPerRun);
  callsPerRun.set(runId, total);
}

export async function runAgent<T>(ctx: StepContext, spec: AgentSpec<T>): Promise<T> {
  // Rejected before queueing: a runaway fan-out should not enqueue thousands of
  // closures before anyone notices.
  countCall(ctx.runId);

  const queuedAt = Date.now();

  return limit(async () => {
    // Checked here rather than on entry, because a fan-out calls runAgent for
    // every unit before any of them completes — so nearly all of them pass an
    // entry check, and it is the ones already waiting that must not proceed.
    if (breaker.tripped) throw new RateLimitExhaustedError(breaker);

    await recordQueueWait(ctx.runStepId, Date.now() - queuedAt);

    const startedAt = Date.now();
    let trace: CallTrace = { retries: 0 };
    let thrown: unknown;

    // Failures arrive two ways — as a raised error, or as a result message with
    // an error subtype. Handling both costs a branch and avoids depending on
    // which one a given SDK version uses.
    try {
      trace = await collectResult(spec);
    } catch (err) {
      thrown = err;
    }

    const { result, retries } = trace;
    const durationMs = Date.now() - startedAt;

    if (!result || result.subtype !== 'success') {
      await writeAgentCall(ctx, spec, {
        isError: true,
        resultSubtype: result?.subtype ?? null,
        durationMs,
        numTurns: result?.num_turns ?? null,
        modelUsage: result?.modelUsage ?? {},
        totalCostUsd: result?.total_cost_usd ?? null,
      });
      const retried = retries > 0 ? ` after ${retries} SDK retries` : '';
      throw (
        thrown ??
        new Error(
          `agent ${spec.name} produced ${result ? `a ${result.subtype} result` : 'no result message'}${retried}`,
        )
      );
    }

    // Recorded before the schema check so a call that ran but returned the wrong
    // shape still shows its token cost.
    const parsed = spec.schema.safeParse(result.structured_output);
    await writeAgentCall(ctx, spec, {
      isError: !parsed.success,
      resultSubtype: result.subtype,
      durationMs,
      numTurns: result.num_turns,
      modelUsage: result.modelUsage,
      totalCostUsd: result.total_cost_usd,
    });

    if (!parsed.success) {
      throw new Error(`agent ${spec.name} returned output failing its schema: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

type CallTrace = { result?: ResultMessage; retries: number };

/**
 * Drains the message stream, watching for the two signals that the subscription
 * quota is spent.
 *
 * The SDK retries API errors itself and reports each attempt as an `api_retry`
 * message carrying a typed error. That message is the earliest and cleanest
 * rate-limit signal available: a terminal `SDKResultError` has no status code
 * and no classification, only an untyped `errors: string[]`.
 */
async function collectResult<T>(spec: AgentSpec<T>): Promise<CallTrace> {
  let result: ResultMessage | undefined;
  let retries = 0;

  for await (const message of query({ prompt: spec.prompt, options: buildOptions(spec) })) {
    if (message.type === 'result') {
      result = message;
      continue;
    }

    if (message.type === 'system' && message.subtype === 'api_retry') {
      retries++;
      if (message.error === 'rate_limit') tripBreaker('rate-limited request retried');
      continue;
    }

    if (message.type === 'rate_limit_event' && message.rate_limit_info.status === 'rejected') {
      tripBreaker('rate limit rejected', message.rate_limit_info.resetsAt);
    }
  }

  return { result, retries };
}

function buildOptions<T>(spec: AgentSpec<T>): Options {
  return {
    model: spec.model,
    // A string replaces the Claude Code preset; the object form appends to it.
    systemPrompt: spec.systemPrompt,
    // Isolation mode: no user, project, or local settings, and no CLAUDE.md.
    // Every agent task must be reproducible from its own prompt alone.
    settingSources: [],
    // These agents transform text; none needs a filesystem or a shell.
    allowedTools: spec.allowedTools ?? [],
    title: spec.name,
    outputFormat: {
      type: 'json_schema',
      schema: z.toJSONSchema(spec.schema) as Record<string, unknown>,
    },
    maxBudgetUsd: spec.maxBudgetUsd ?? DEFAULT_AGENT_BUDGET_USD,
    ...(spec.mcpServers ? { mcpServers: spec.mcpServers } : {}),
  };
}

export type UsageRollup = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/**
 * Totals a per-model usage record. One call can span several models, so these
 * are sums rather than a single model's figures — the per-model detail is kept
 * verbatim in `agent_calls.model_usage`.
 */
export function summarizeUsage(modelUsage: Record<string, ModelUsageEntry>): UsageRollup {
  const total: UsageRollup = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  for (const usage of Object.values(modelUsage)) {
    total.inputTokens += usage.inputTokens ?? 0;
    total.outputTokens += usage.outputTokens ?? 0;
    total.cacheReadTokens += usage.cacheReadInputTokens ?? 0;
    total.cacheCreationTokens += usage.cacheCreationInputTokens ?? 0;
  }

  return total;
}

type CallOutcome = {
  isError: boolean;
  resultSubtype: string | null;
  durationMs: number;
  numTurns: number | null;
  modelUsage: Record<string, ModelUsageEntry>;
  totalCostUsd: number | null;
};

async function writeAgentCall<T>(
  ctx: StepContext,
  spec: AgentSpec<T>,
  outcome: CallOutcome,
): Promise<void> {
  await db.insert(agentCalls).values({
    runId: ctx.runId,
    runStepId: ctx.runStepId,
    agentName: spec.name,
    model: spec.model,
    isError: outcome.isError,
    resultSubtype: outcome.resultSubtype,
    numTurns: outcome.numTurns,
    durationMs: outcome.durationMs,
    modelUsage: outcome.modelUsage,
    ...summarizeUsage(outcome.modelUsage),
    totalCostUsd: outcome.totalCostUsd,
  });
}

/** Time spent waiting on the semaphore — the input to Phase 7's tuning decision. */
async function recordQueueWait(runStepId: string, queueWaitMs: number): Promise<void> {
  await db.update(runSteps).set({ queueWaitMs }).where(eq(runSteps.id, runStepId));
}
