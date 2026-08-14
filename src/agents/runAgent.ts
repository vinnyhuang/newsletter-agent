import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { eq } from 'drizzle-orm';
import pLimit from 'p-limit';
import { z } from 'zod';
import { AGENT_CONCURRENCY, DEFAULT_AGENT_BUDGET_USD } from '../config/agents.ts';
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

/**
 * Concurrency is mutable rather than fixed at construction: P0-7's rate-limit
 * backoff works by lowering the live limit and raising it again, and a CLI flag
 * resolves at startup after this module has already been imported.
 */
const limit = pLimit(AGENT_CONCURRENCY);

export function setAgentConcurrency(concurrency: number): void {
  limit.concurrency = concurrency;
}

export function getAgentConcurrency(): number {
  return limit.concurrency;
}

export async function runAgent<T>(ctx: StepContext, spec: AgentSpec<T>): Promise<T> {
  const queuedAt = Date.now();

  return limit(async () => {
    await recordQueueWait(ctx.runStepId, Date.now() - queuedAt);

    const startedAt = Date.now();
    let result: ResultMessage | undefined;
    let thrown: unknown;

    // Failures arrive two ways — as a raised error, or as a result message with
    // an error subtype. Handling both costs a branch and avoids depending on
    // which one a given SDK version uses.
    try {
      result = await collectResult(spec);
    } catch (err) {
      thrown = err;
    }

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
      throw (
        thrown ??
        new Error(
          `agent ${spec.name} produced ${result ? `a ${result.subtype} result` : 'no result message'}`,
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

async function collectResult<T>(spec: AgentSpec<T>): Promise<ResultMessage | undefined> {
  let result: ResultMessage | undefined;
  for await (const message of query({ prompt: spec.prompt, options: buildOptions(spec) })) {
    if (message.type === 'result') result = message;
  }
  return result;
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
