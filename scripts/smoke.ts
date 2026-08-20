import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { runAgent } from '../src/agents/runAgent.ts';
import { lastRateLimitSnapshot } from '../src/agents/runAgent.ts';
import { STEP_MODELS } from '../src/config/models.ts';
import { closeDb, db } from '../src/db/client.ts';
import { agentCalls, runSteps, runs } from '../src/db/schema.ts';
import { withStep } from '../src/db/steps.ts';
import {
  shutdownObservability,
  startObservability,
} from '../src/observability/instrumentation.ts';

/**
 * End-to-end check: real model calls, real database writes, real traces.
 *
 *   pnpm smoke                  reuse the latest smoke run, or start one
 *   pnpm smoke --fresh          start a new run
 *
 * Deliberately not part of `pnpm test`. Every call costs ~25k tokens of harness
 * prompt against the subscription quota, so this runs on demand — after an SDK
 * upgrade, or when agent calls start failing and the question is whether the
 * problem is our code or the CLI underneath it.
 *
 * Re-running against the same run is the resume check: completed steps replay
 * from `run_steps` and make no model call at all.
 */

const WEEK = 'smoke';
const fresh = process.argv.includes('--fresh');

const QUESTIONS = [
  { unit: 'france', prompt: 'What is the capital of France?' },
  { unit: 'japan', prompt: 'What is the capital of Japan?' },
];

const Answer = z.object({ capital: z.string() });

async function findOrCreateRun(): Promise<{ id: string; reused: boolean }> {
  if (!fresh) {
    const [existing] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.weekId, WEEK), eq(runs.status, 'running')))
      .orderBy(desc(runs.startedAt))
      .limit(1);
    if (existing) return { id: existing.id, reused: true };
  }
  const [created] = await db.insert(runs).values({ weekId: WEEK }).returning();
  if (!created) throw new Error('failed to create run');
  return { id: created.id, reused: false };
}

async function callCount(runId: string): Promise<number> {
  const rows = await db.select().from(agentCalls).where(eq(agentCalls.runId, runId));
  return rows.length;
}

startObservability();

const { id: runId, reused } = await findOrCreateRun();
console.log(`run ${runId}${reused ? ' (reused — completed steps should replay)' : ' (new)'}\n`);

for (const { unit, prompt } of QUESTIONS) {
  const before = await callCount(runId);
  const started = Date.now();

  const answer = await withStep({ runId, stepName: 'askCapital', unitKey: unit }, (ctx) =>
    runAgent(ctx, {
      name: 'askCapital',
      model: STEP_MODELS.triage,
      // Byte-stable across calls so the ~21k prompt prefix stays cached.
      systemPrompt: 'You answer geography questions. Respond only with the requested data.',
      prompt,
      schema: Answer,
    }),
  );

  const madeCall = (await callCount(runId)) > before;
  console.log(
    `  ${unit.padEnd(8)} ${JSON.stringify(answer).padEnd(24)} ` +
      `${madeCall ? 'called the model' : 'REPLAYED from run_steps'} in ${Date.now() - started}ms`,
  );
}

const calls = await db.select().from(agentCalls).where(eq(agentCalls.runId, runId));
const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId));

console.log(`\nsteps      : ${steps.map((s) => `${s.unitKey}=${s.status}`).join(' ')}`);
console.log(`agent calls: ${calls.length} total for this run`);
for (const call of calls) {
  console.log(
    `  ${call.agentName} in=${call.inputTokens} out=${call.outputTokens} ` +
      `cacheRead=${call.cacheReadTokens} cacheCreate=${call.cacheCreationTokens} ` +
      `trace=${call.langfuseTraceId?.slice(0, 12) ?? 'none'}`,
  );
}

const quota = lastRateLimitSnapshot();
console.log(
  `quota      : ${
    quota
      ? `${quota.status} · ${quota.rateLimitType ?? 'unknown window'} · ` +
        `utilization=${quota.utilization ?? 'n/a'} · overage=${quota.isUsingOverage ?? false}`
      : '(no rate_limit_event seen)'
  }`,
);

await shutdownObservability();
await closeDb();
