import { query } from '@anthropic-ai/claude-agent-sdk';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { AGENT_CONCURRENCY } from '../config/agents.ts';
import { MODEL_IDS } from '../config/models.ts';
import { closeDb, db } from '../db/client.ts';
import { agentCalls, runSteps, runs } from '../db/schema.ts';
import type { StepContext } from '../db/steps.ts';
import { getAgentConcurrency, runAgent, setAgentConcurrency, summarizeUsage } from './runAgent.ts';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

const Schema = z.object({ capital: z.string() });

/**
 * Cleanup is by the ids this file created, not by a shared marker. Vitest runs
 * test files in parallel, so deleting on a marker any other file also uses
 * would cascade away that file's fixtures mid-run.
 */
const createdRuns: string[] = [];

afterAll(async () => {
  if (createdRuns.length) await db.delete(runs).where(inArray(runs.id, createdRuns));
  await closeDb();
});

beforeEach(() => {
  vi.mocked(query).mockReset();
  setAgentConcurrency(AGENT_CONCURRENCY);
});

/** A run plus a step row, so the agent_calls foreign keys resolve. */
async function newContext(): Promise<StepContext> {
  const [run] = await db.insert(runs).values({ weekId: 'test-runagent' }).returning();
  if (!run) throw new Error('failed to create run');
  createdRuns.push(run.id);
  const [step] = await db
    .insert(runSteps)
    .values({ runId: run.id, stepName: 'agentStep', unitKey: crypto.randomUUID() })
    .returning();
  if (!step) throw new Error('failed to create step');
  return { runId: run.id, runStepId: step.id, attempt: 1 };
}

function spec(overrides: Partial<Parameters<typeof runAgent<{ capital: string }>>[1]> = {}) {
  return {
    name: 'probe',
    model: MODEL_IDS.SONNET,
    systemPrompt: 'Answer tersely.',
    prompt: 'Capital of France?',
    schema: Schema,
    ...overrides,
  };
}

const SONNET_USAGE = {
  inputTokens: 2,
  outputTokens: 96,
  cacheReadInputTokens: 21281,
  cacheCreationInputTokens: 3989,
  costUSD: 0.031764,
};

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 2,
    duration_ms: 1200,
    total_cost_usd: 0.031764,
    structured_output: { capital: 'Paris' },
    modelUsage: { 'claude-sonnet-5': SONNET_USAGE },
    ...overrides,
  };
}

/**
 * `Query` is an async iterable plus ~27 control methods. Only the iteration is
 * exercised here, so the generator is cast through `unknown` in one place.
 */
function asQuery(gen: AsyncGenerator<unknown>): ReturnType<typeof query> {
  return gen as unknown as ReturnType<typeof query>;
}

/** Drives the mocked query() with a fixed sequence of messages. */
function yields(...messages: unknown[]) {
  vi.mocked(query).mockImplementation(() =>
    asQuery(
      (async function* () {
        for (const message of messages) yield message;
      })(),
    ),
  );
}

async function callsFor(ctx: StepContext) {
  return db.select().from(agentCalls).where(eq(agentCalls.runId, ctx.runId));
}

test('returns the structured output, validated against the schema', async () => {
  const ctx = await newContext();
  yields(successResult());

  const output = await runAgent(ctx, spec());

  expect(output).toEqual({ capital: 'Paris' });
});

test('passes isolation options and a JSON Schema derived from the zod schema', async () => {
  const ctx = await newContext();
  yields(successResult());

  await runAgent(ctx, spec());

  const options = vi.mocked(query).mock.calls[0]?.[0]?.options;
  expect(options?.settingSources).toEqual([]);
  expect(options?.allowedTools).toEqual([]);
  expect(options?.systemPrompt).toBe('Answer tersely.');
  expect(options?.outputFormat).toEqual({
    type: 'json_schema',
    schema: expect.objectContaining({
      type: 'object',
      properties: { capital: { type: 'string' } },
      required: ['capital'],
      additionalProperties: false,
    }),
  });
});

test('records an agent_calls row linked to the step, with usage rolled up', async () => {
  const ctx = await newContext();
  yields(successResult());

  await runAgent(ctx, spec());

  const [call] = await callsFor(ctx);
  expect(call?.runStepId).toBe(ctx.runStepId);
  expect(call?.agentName).toBe('probe');
  expect(call?.isError).toBe(false);
  expect(call?.resultSubtype).toBe('success');
  expect(call?.inputTokens).toBe(2);
  expect(call?.outputTokens).toBe(96);
  expect(call?.cacheReadTokens).toBe(21281);
  expect(call?.modelUsage['claude-sonnet-5']?.costUSD).toBe(0.031764);
});

test('rolls up usage across every model a call touched', async () => {
  const ctx = await newContext();
  yields(
    successResult({
      modelUsage: {
        'claude-sonnet-5': SONNET_USAGE,
        'claude-haiku-4-5': {
          inputTokens: 529,
          outputTokens: 14,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.000599,
        },
      },
    }),
  );

  await runAgent(ctx, spec());

  const [call] = await callsFor(ctx);
  expect(call?.inputTokens).toBe(531);
  expect(call?.outputTokens).toBe(110);
  expect(Object.keys(call?.modelUsage ?? {})).toHaveLength(2);
});

test('records queue wait on the step row', async () => {
  const ctx = await newContext();
  yields(successResult());

  await runAgent(ctx, spec());

  const [step] = await db.select().from(runSteps).where(eq(runSteps.id, ctx.runStepId));
  expect(step?.queueWaitMs).toBeGreaterThanOrEqual(0);
});

test('output failing the schema throws, and the call is still recorded', async () => {
  const ctx = await newContext();
  yields(successResult({ structured_output: { capitol: 'Paris' } }));

  await expect(runAgent(ctx, spec())).rejects.toThrow(/failing its schema/);

  const [call] = await callsFor(ctx);
  expect(call?.isError).toBe(true);
  // The call ran, so its cost is recorded even though the output was unusable.
  expect(call?.inputTokens).toBe(2);
});

test('an error-subtype result throws, and the call is recorded', async () => {
  const ctx = await newContext();
  yields({
    type: 'result',
    subtype: 'error_max_budget_usd',
    is_error: true,
    num_turns: 1,
    total_cost_usd: 0.0001,
    modelUsage: { 'claude-sonnet-5': SONNET_USAGE },
  });

  await expect(runAgent(ctx, spec())).rejects.toThrow(/error_max_budget_usd/);

  const [call] = await callsFor(ctx);
  expect(call?.isError).toBe(true);
  expect(call?.resultSubtype).toBe('error_max_budget_usd');
});

test('a thrown SDK error propagates, and the call is recorded', async () => {
  const ctx = await newContext();
  vi.mocked(query).mockImplementation(() =>
    asQuery(
      (async function* () {
        throw new Error('Claude Code returned an error result: Reached maximum budget');
      })(),
    ),
  );

  await expect(runAgent(ctx, spec())).rejects.toThrow(/Reached maximum budget/);

  const [call] = await callsFor(ctx);
  expect(call?.isError).toBe(true);
  expect(call?.resultSubtype).toBeNull();
  expect(call?.modelUsage).toEqual({});
});

test('a stream with no result message throws', async () => {
  const ctx = await newContext();
  yields({ type: 'assistant' });

  await expect(runAgent(ctx, spec())).rejects.toThrow(/no result message/);
});

test('the semaphore caps calls in flight', async () => {
  const ctx = await newContext();
  setAgentConcurrency(2);

  let inFlight = 0;
  let peak = 0;
  vi.mocked(query).mockImplementation(() =>
    asQuery(
      (async function* () {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 25));
        inFlight--;
        yield successResult();
      })(),
    ),
  );

  await Promise.all(Array.from({ length: 6 }, () => runAgent(ctx, spec())));

  expect(peak).toBe(2);
});

test('setAgentConcurrency changes the live limit', () => {
  setAgentConcurrency(7);
  expect(getAgentConcurrency()).toBe(7);
});

test('summarizeUsage totals an empty record to zeroes', () => {
  expect(summarizeUsage({})).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
});
