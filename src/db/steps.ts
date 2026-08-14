import { and, eq } from 'drizzle-orm';
import { db } from './client.ts';
import { runSteps } from './schema.ts';

/**
 * Memoized execution of one unit of nondeterministic work.
 *
 * A completed step's result is replayed from `run_steps` instead of being
 * recomputed, which is what makes an interrupted run resumable: re-entering the
 * graph from the top costs a row read per finished step rather than a model
 * call. This is the only resume mechanism — there is no graph checkpointer.
 *
 * A stored result is returned as-is, without validation. Keeping stored results
 * compatible with the current code is operational: after changing the shape a
 * step returns, purge that step's rows before resuming a run that predates the
 * change.
 */

/** Passed to the work function so it can attach records to its own step row. */
export type StepContext = {
  runId: string;
  runStepId: string;
  attempt: number;
};

export type StepDescriptor = {
  runId: string;
  /** The pipeline stage, e.g. `triageStory`. */
  stepName: string;
  /**
   * Identifies the unit within the stage. Must be deterministic and derived
   * from content, never from position in a list — an array index would replay
   * the wrong unit's result if ordering changed between runs.
   *
   * Omit for steps that run once per run; it stores as `''` rather than null so
   * the unique index still collides (Postgres treats nulls as distinct).
   */
  unitKey?: string;
};

/**
 * Assumes each step is dispatched to exactly one caller. Per-unit steps fan out
 * over `story_units`, which is globally unique on `dedupe_key`, so the same key
 * cannot appear twice in one fan-out; run-level steps run once; and one CLI runs
 * at a time. A row still marked `running` therefore belongs to a process that
 * died mid-step, and is taken over rather than waited on.
 */
export async function withStep<T>(
  { runId, stepName, unitKey = '' }: StepDescriptor,
  fn: (ctx: StepContext) => Promise<T>,
): Promise<T> {
  const existing = await findStep(runId, stepName, unitKey);
  if (existing?.status === 'done') return existing.result as T;

  const claimed = await claim(runId, stepName, unitKey, existing);

  try {
    const produced = await fn({ runId, runStepId: claimed.id, attempt: claimed.attempt });
    await db
      .update(runSteps)
      .set({ status: 'done', result: produced ?? null, error: null, finishedAt: new Date() })
      .where(eq(runSteps.id, claimed.id));
    return produced;
  } catch (err) {
    await db
      .update(runSteps)
      .set({ status: 'failed', error: describeError(err), finishedAt: new Date() })
      .where(eq(runSteps.id, claimed.id));
    throw err;
  }
}

async function findStep(runId: string, stepName: string, unitKey: string) {
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

/**
 * Marks the step as running and returns the row to write the outcome into.
 *
 * An existing row is taken over whatever its status, resetting the error and
 * result so a retry inherits nothing from the previous attempt.
 *
 * Deliberately not wrapped in a transaction with the work itself — `fn` makes
 * model calls that can take minutes, and holding a transaction open across one
 * would pin a connection and block vacuum.
 */
async function claim(
  runId: string,
  stepName: string,
  unitKey: string,
  existing: { id: string; attempt: number } | undefined,
) {
  if (existing) {
    const [row] = await db
      .update(runSteps)
      .set({
        status: 'running',
        attempt: existing.attempt + 1,
        error: null,
        result: null,
        startedAt: new Date(),
        finishedAt: null,
      })
      .where(eq(runSteps.id, existing.id))
      .returning();
    if (!row) throw new Error(`step ${existing.id} vanished while claiming`);
    return row;
  }

  const [row] = await db
    .insert(runSteps)
    .values({ runId, stepName, unitKey, status: 'running' })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
