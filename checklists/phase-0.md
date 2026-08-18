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

- [x] **P0-2 — Verify Claude Agent SDK option surface**
  - De-risk before `runAgent.ts` is written against assumptions. Confirm in the
    installed `@anthropic-ai/claude-agent-sdk` that structured output via JSON
    schema, `settingSources: []`, and a per-call budget guard exist and behave
    as the plan assumes. All three do.
  - Confirm which usage and cost fields the result message carries under
    subscription auth, and how errors surface.
  - Write a probe making real `query()` calls, exercising each option
    independently so a later SDK upgrade can be re-checked the same way.

- [x] **P0-3 — Wire Drizzle ORM and Postgres client** *(blocks P0-4)*
  - `docker-compose.yml` — dedicated Postgres container, isolated from any
    Postgres already running on the host. `pnpm db:up` / `db:down`.
  - `.env` supplies the database parts to both `src/config/env.ts` and Compose;
    `env.ts` assembles the connection URL from them
  - `src/db/client.ts` — pool sized above `AGENT_CONCURRENCY`, exports `closeDb()`
  - `src/db/schema.ts` entry point and `drizzle.config.ts`
  - `db:generate` / `db:migrate` scripts via drizzle-kit

- [x] **P0-4 — Write Phase 0 migration** *(blocked by P0-3; blocks P0-5)*
  - `runs`
  - `run_steps` — `UNIQUE (run_id, step_name, unit_key)`, status
    `pending|running|done|failed`, `result` jsonb, `error`, `attempt`,
    `started_at`, `finished_at`, plus `queue_wait_ms` for Phase 7 tuning data
  - `agent_calls` — token counts primary, reported cost derived, Langfuse trace
    id. **Store the result's `modelUsage` as jsonb**, not flat token columns:
    the SDK documents `modelUsage` (keyed by model id) as the correct field for
    token accounting, and `usage` as main-agent-loop-only. A single call can
    therefore span several models, which flat columns would silently drop.

- [x] **P0-5 — Implement `withStep` memoization helper with tests** *(blocked by P0-4; blocks P0-6)*
  - `src/db/steps.ts`: returns the stored result if a `done` row exists,
    otherwise marks running, executes, records `done` or `failed`. Memoization
    only — validating results is the caller's job.
  - Treat `running` exactly like `failed` — each step has one caller, so a row
    still marked running was abandoned by a process that died mid-step
  - This is the entire resume mechanism, so it gets tests first: second call
    with the same key does not invoke `fn`; a failed step retries on the next
    call; a step left running is taken over

- [x] **P0-6 — Implement `runAgent.ts` wrapper** *(blocked by P0-2, P0-5)*
  - Wraps `query()`. Takes `{ name, systemPrompt, prompt, schema, model,
    budget, mcpServers?, allowedTools? }`
  - Always pass `settingSources: []` (SDK isolation mode — also keeps
    `CLAUDE.md` out of the agent's context) and a `systemPrompt` string, which
    replaces the Claude Code preset rather than appending to it
  - **Handle failure both ways**: wrap the message loop in try/catch *and*
    check the result message's subtype. Two lines, and it does not depend on
    assumptions about which errors throw versus which are yielded.
  - Acquires the global p-limit semaphore (`AGENT_CONCURRENCY`, default 4),
    validates with zod, writes an `agent_calls` row, returns typed output
  - Build the seam for a `--concurrency` override: a module-level limiter whose
    concurrency is mutable, exposed via `setAgentConcurrency()`. The flag itself
    is wired when the CLI exists in P1; P0-7's backoff uses the same setter.

- [x] **P0-7 — Add a circuit breaker and runaway guard to `runAgent`**
  - Trip a circuit breaker on the first `api_retry` carrying
    `error: 'rate_limit'`, or on a `rate_limit_event` with `status: 'rejected'`,
    capturing `resetsAt` when present
  - Once tripped, throw `RateLimitExhaustedError` without reaching the SDK, so
    the run ends quickly and resumes cheaply after the window resets
  - Check the breaker inside the semaphore rather than on entry — a fan-out
    calls `runAgent` for every unit before any completes, so it is the queued
    calls that need stopping
  - Count `api_retry` messages and report the count in the error of a call that
    fails after retries
  - Enforce a per-run ceiling on agent calls (`MAX_AGENT_CALLS_PER_RUN`) before
    queueing, with `setMaxAgentCallsPerRun()` as the seam for `--max-calls` in P1
  - No retry layer and no adaptive concurrency: the SDK owns retries, and these
    rate limits are long-window quotas rather than rates

- [x] **P0-8 — Set up Langfuse and OTel instrumentation**
  - Clone and run `langfuse/langfuse` separately via its own docker compose
    (its own Postgres/Clickhouse/Redis/MinIO — not entangled with this project),
    overriding the ports it publishes to avoid local collisions
  - Record steps in `docs/langfuse-setup.md`
  - `src/observability/instrumentation.ts`: OTel `NodeSDK` with
    `LangfuseSpanProcessor` plus `ClaudeAgentSDKInstrumentation`, started
    explicitly by CLI entry points so importing it in a test opens no exporter
  - `src/observability/agentSdk.ts`: route `query` through a swappable handle —
    under ESM the instrumentation returns a new module object rather than
    patching exports in place, so a direct import would emit no spans
  - Open a span per call in `runAgent` to parent the SDK's spans and supply
    `agent_calls.langfuse_trace_id`
  - Strip zod's `$schema` key before passing the JSON Schema to the SDK; the
    CLI rejects it

- [x] **P0-9 — Run Phase 0 exit check** *(blocked by P0-6, P0-7, P0-8)*
  - Commit the end-to-end check as `scripts/smoke.ts` / `pnpm smoke`, kept out of
    `pnpm test` so real model calls never run in the fast loop. `--fresh` starts
    a run; a bare invocation reuses the latest one, which is the resume check.
  - Record the last `rate_limit_event` and expose it via
    `lastRateLimitSnapshot()`; warn on paid overage, and on high utilization,
    rather than logging a line per call
