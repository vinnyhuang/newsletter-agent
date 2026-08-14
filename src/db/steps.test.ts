import { and, eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { closeDb, db } from './client.ts';
import { runSteps, runs } from './schema.ts';
import { withStep } from './steps.ts';

/** Marks rows as test fixtures so they can be cleared without touching real runs. */
const TEST_WEEK = 'test-week';

afterAll(async () => {
  // Cascades to run_steps and agent_calls.
  await db.delete(runs).where(eq(runs.weekId, TEST_WEEK));
  await closeDb();
});

/** Each test gets its own run, so they can run in any order or in parallel. */
async function newRun(): Promise<string> {
  const [run] = await db.insert(runs).values({ weekId: TEST_WEEK }).returning();
  if (!run) throw new Error('failed to create run');
  return run.id;
}

async function stepRow(runId: string, stepName: string, unitKey = '') {
  const [row] = await db
    .select()
    .from(runSteps)
    .where(
      and(
        eq(runSteps.runId, runId),
        eq(runSteps.stepName, stepName),
        eq(runSteps.unitKey, unitKey),
      ),
    );
  return row;
}

test('executes the work and stores the result', async () => {
  const runId = await newRun();
  let calls = 0;

  const value = await withStep({ runId, stepName: 'triage', unitKey: 'a' }, async () => {
    calls++;
    return { keep: true };
  });

  expect(value).toEqual({ keep: true });
  expect(calls).toBe(1);

  const row = await stepRow(runId, 'triage', 'a');
  expect(row?.status).toBe('done');
  expect(row?.result).toEqual({ keep: true });
  expect(row?.finishedAt).not.toBeNull();
});

test('replays a completed step without invoking the work again', async () => {
  const runId = await newRun();
  let calls = 0;
  const work = async () => {
    calls++;
    return { keep: true, n: calls };
  };

  const first = await withStep({ runId, stepName: 'triage', unitKey: 'a' }, work);
  const second = await withStep({ runId, stepName: 'triage', unitKey: 'a' }, work);

  expect(calls).toBe(1);
  expect(second).toEqual(first);
});

test('memoizes per unit, not per step', async () => {
  const runId = await newRun();
  const seen: string[] = [];
  const work = (unit: string) => async () => {
    seen.push(unit);
    return unit;
  };

  await withStep({ runId, stepName: 'triage', unitKey: 'a' }, work('a'));
  await withStep({ runId, stepName: 'triage', unitKey: 'b' }, work('b'));
  await withStep({ runId, stepName: 'triage', unitKey: 'a' }, work('a'));

  expect(seen).toEqual(['a', 'b']);
});

test('memoizes run-level steps, which carry no unit key', async () => {
  const runId = await newRun();
  let calls = 0;
  const work = async () => {
    calls++;
    return 'scored';
  };

  await withStep({ runId, stepName: 'scoreAndRoute' }, work);
  await withStep({ runId, stepName: 'scoreAndRoute' }, work);

  expect(calls).toBe(1);
  expect((await stepRow(runId, 'scoreAndRoute'))?.unitKey).toBe('');
});

test('a failure is recorded and retried on the next call', async () => {
  const runId = await newRun();
  let calls = 0;
  const work = async () => {
    calls++;
    if (calls === 1) throw new Error('fetch timed out');
    return 'recovered';
  };

  await expect(
    withStep({ runId, stepName: 'processStory', unitKey: 'a' }, work),
  ).rejects.toThrow('fetch timed out');

  const failed = await stepRow(runId, 'processStory', 'a');
  expect(failed?.status).toBe('failed');
  expect(failed?.error).toContain('fetch timed out');
  expect(failed?.attempt).toBe(1);

  const value = await withStep({ runId, stepName: 'processStory', unitKey: 'a' }, work);
  expect(value).toBe('recovered');

  const retried = await stepRow(runId, 'processStory', 'a');
  expect(retried?.status).toBe('done');
  expect(retried?.attempt).toBe(2);
  expect(retried?.error).toBeNull();
});

test('takes over a step left running by a crashed process', async () => {
  const runId = await newRun();
  await db
    .insert(runSteps)
    .values({ runId, stepName: 'summarize', unitKey: 'a', status: 'running' });

  const value = await withStep({ runId, stepName: 'summarize', unitKey: 'a' }, async () => 'done');

  expect(value).toBe('done');
  const row = await stepRow(runId, 'summarize', 'a');
  expect(row?.status).toBe('done');
  expect(row?.attempt).toBe(2);
});

test('the work receives its own step row id', async () => {
  const runId = await newRun();
  let seenId = '';

  await withStep({ runId, stepName: 'triage', unitKey: 'a' }, async (ctx) => {
    seenId = ctx.runStepId;
    return null;
  });

  expect((await stepRow(runId, 'triage', 'a'))?.id).toBe(seenId);
});
