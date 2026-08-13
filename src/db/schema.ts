/**
 * Drizzle schema — the single source of truth for the database structure.
 *
 * Tables are added phase by phase rather than all at once, so every migration
 * is small enough to read and is tied to code that exercises it. See the
 * "Migrations" section of the plan document for the per-phase breakdown.
 *
 * Workflow: edit this file, run `pnpm db:generate` to emit a migration, read
 * the generated SQL, then `pnpm db:migrate` to apply it. Never hand-write the
 * SQL — it is derived from these definitions.
 *
 * Phase 0 tables (runs, run_steps, agent_calls) arrive in P0-4.
 */

export {};
