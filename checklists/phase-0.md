# Phase 0 — Foundations

**Exit check:** `pnpm db:migrate` succeeds; Langfuse reachable locally; a
hello-world agent call appears there as a trace with token counts; killing that
call mid-flight and re-running skips it via `withStep` rather than re-executing.

---

- [x] **P0-1 — Scaffold TypeScript project and config**
  - pnpm, TypeScript ESM, tsx, vitest, zod, p-limit
  - `.gitignore` (covers `data/`, `.env`), `.env.example`
  - `src/config/env.ts` — zod-validated environment, fails loudly at startup.
    Holds secrets and per-machine values only.
  - `src/config/models.ts` — pinned model IDs, never alias-resolved at runtime
  - `src/config/agents.ts` — concurrency and the runaway-guard ceiling. Defaults
    live in version control, not `.env`, so a change to them is reviewable.
    Ad-hoc overrides come from CLI flags, wired up in P0-6/P0-7.

- [ ] **P0-2 — Verify Claude Agent SDK option surface**
  - De-risk before `runAgent.ts` depends on it. Confirm in the installed
    `@anthropic-ai/claude-agent-sdk`: structured output via JSON schema,
    `settingSources: []`, a per-call budget guard, and what usage/cost fields
    come back under subscription auth.
  - Findings so far: `outputFormat?: OutputFormat` where
    `OutputFormat = JsonSchemaOutputFormat`; `settingSources?: SettingSource[]`
    with `SettingSource = 'user' | 'project' | 'local'`; `maxBudgetUsd?: number`
    with an `error_max_budget_usd` result subtype. Also an
    `error_max_structured_output_retries` subtype — the SDK retries schema
    violations internally, which affects what P0-7 should duplicate.
  - Remaining: exact type shapes, usage/cost fields on the result message.

- [ ] **P0-3 — Wire Drizzle ORM and Postgres client** *(blocks P0-4)*
  - `src/db/client.ts` with a pool sized above `AGENT_CONCURRENCY`
  - `schema.ts` entry point, `db:generate` / `db:migrate` scripts
  - Create the local database

- [ ] **P0-4 — Write Phase 0 migration** *(blocked by P0-3; blocks P0-5)*
  - `runs`
  - `run_steps` — `UNIQUE (run_id, step_name, unit_key)`, status
    `pending|running|done|failed`, `result` jsonb, `error`, `attempt`,
    `started_at`, `finished_at`, plus `queue_wait_ms` for Phase 7 tuning data
  - `agent_calls` — token counts primary, reported cost derived, Langfuse trace id

- [ ] **P0-5 — Implement `withStep` memoization helper with tests** *(blocked by P0-4; blocks P0-6)*
  - `src/db/steps.ts`: returns the stored result if a `done` row exists,
    otherwise marks running, executes, validates, records `done` or `failed`
  - This is the entire resume mechanism, so it gets tests first: second call
    with the same key does not invoke `fn`; a failed step retries on the next
    call; concurrent calls on the same key do not double-execute

- [ ] **P0-6 — Implement `runAgent.ts` wrapper** *(blocked by P0-2, P0-5)*
  - Wraps `query()`. Takes `{ name, systemPrompt, prompt, schema, model,
    budget, mcpServers?, allowedTools? }`
  - Acquires the global p-limit semaphore (`AGENT_CONCURRENCY`, default 4),
    validates with zod, writes an `agent_calls` row, returns typed output
  - Expose a `--concurrency` CLI flag overriding the `agents.ts` default for a
    single invocation. Needs a seam: the semaphore is constructed once, so
    resolve the value at startup rather than importing the constant directly at
    every call site.

- [ ] **P0-7 — Add backoff, retry, and runaway guard to `runAgent`**
  - Adaptive backoff: a rate-limit response drops effective concurrency to 1
    globally, honors the retry delay, ramps back over subsequent successes
  - Retry with exponential backoff and jitter, capped attempts; on exhaustion
    mark the `run_steps` row failed and let the graph continue
  - Hard ceiling on total agent calls per run (`MAX_AGENT_CALLS_PER_RUN`),
    with a `--max-calls` CLI flag to override it for a single invocation

- [ ] **P0-8 — Set up Langfuse and OTel instrumentation**
  - Clone and run `langfuse/langfuse` separately via its own docker compose
    (its own Postgres/Clickhouse/Redis/MinIO — not entangled with this project)
  - Record steps in `docs/langfuse-setup.md`
  - `src/observability/instrumentation.ts`: OTel `NodeSDK` with
    `LangfuseSpanProcessor` plus `ClaudeAgentSDKInstrumentation`, with a
    `shouldExportSpan` filter admitting that scope. Imported first.

- [ ] **P0-9 — Run Phase 0 exit check** *(blocked by P0-6, P0-7, P0-8)*
