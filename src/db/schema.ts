import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — the single source of truth for the database structure.
 *
 * Tables are added phase by phase. Workflow: edit this file, run
 * `pnpm db:generate --name <descriptive_name>` to emit a migration, read the
 * generated SQL, then `pnpm db:migrate` to apply it. Never hand-write the SQL.
 *
 * Always pass `--name`; without it drizzle-kit invents a random one. Name it
 * after what the migration does, not the phase it belongs to — e.g.
 * `create_runs_run_steps_agent_calls`, `add_story_units_dedupe_key_index`.
 */

// --- runs --------------------------------------------------------------------

export const RUN_STATUSES = ['running', 'completed', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** ISO week, e.g. `2026-W32`. Not unique — a week may be run more than once. */
    weekId: text('week_id').notNull(),
    status: text('status').$type<RunStatus>().notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    // `resume` finds the most recent run for a week.
    index('runs_week_started_idx').on(t.weekId, t.startedAt.desc()),
    check('runs_status_check', sql`${t.status} in ('running', 'completed', 'failed')`),
  ],
);

// --- run_steps ---------------------------------------------------------------

export const STEP_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * One row per unit of nondeterministic work. A `done` row's `result` is
 * replayed instead of re-executing, which is what makes a run resumable.
 */
export const runSteps = pgTable(
  'run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepName: text('step_name').notNull(),
    /**
     * Identifies the unit within the step — a story unit's dedupe key, a Gmail
     * message id, a stream name. Empty string, never null, for run-level steps:
     * Postgres treats nulls as distinct in a unique index, so a nullable column
     * here would let the same run-level step be inserted repeatedly.
     */
    unitKey: text('unit_key').notNull().default(''),
    status: text('status').$type<StepStatus>().notNull().default('pending'),
    /** Validated output of a completed step, replayed on resume. */
    result: jsonb('result'),
    error: text('error'),
    attempt: integer('attempt').notNull().default(1),
    /** Time spent waiting on the agent semaphore, for Phase 7 concurrency tuning. */
    queueWaitMs: integer('queue_wait_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('run_steps_run_step_unit_uq').on(t.runId, t.stepName, t.unitKey),
    index('run_steps_run_status_idx').on(t.runId, t.status),
    check(
      'run_steps_status_check',
      sql`${t.status} in ('pending', 'running', 'done', 'failed')`,
    ),
  ],
);

// --- agent_calls -------------------------------------------------------------

/** Subset of the Agent SDK's per-model usage that we rely on when reading back. */
export type ModelUsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
};

/** One row per `query()` call, for cost and rate-limit accounting. */
export const agentCalls = pgTable(
  'agent_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** Null for calls made outside a memoized step. */
    runStepId: uuid('run_step_id').references(() => runSteps.id, { onDelete: 'cascade' }),
    /** The agent task, e.g. `triage`, `summarize`. */
    agentName: text('agent_name').notNull(),
    /** Model requested. A call may still span others; see `modelUsage`. */
    model: text('model').notNull(),
    isError: boolean('is_error').notNull().default(false),
    /** SDK result subtype: `success`, or an error variant. */
    resultSubtype: text('result_subtype'),
    numTurns: integer('num_turns'),
    durationMs: integer('duration_ms'),
    /**
     * Per-model usage keyed by model id, as returned by the SDK. Authoritative:
     * one call can span several models, and the integer columns below are only
     * rollups of this, kept for aggregate queries that would otherwise have to
     * sum across JSON keys.
     */
    modelUsage: jsonb('model_usage').$type<Record<string, ModelUsageEntry>>().notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    /** Notional API price under subscription auth, not billed spend. */
    totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    langfuseTraceId: text('langfuse_trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_calls_run_idx').on(t.runId),
    index('agent_calls_run_step_idx').on(t.runStepId),
  ],
);
