# Phase 6 — Meta-analysis and feedback loop (PRD steps 5–6)

**Exit check:** a full step 1–6 run for one week, interruptible and resumable at
any point, with the next run's triage prompt visibly carrying the prior week's
feedback.

*Expand into granular tasks when reached.*

---

- [ ] `metaAnalyze` (Opus 5) — receives run statistics from `run_steps` and
      `agent_calls` (counts, drops, recurrences, low-confidence items, failed
      fetches, sponsor-filter counts, queue wait and tokens per step)
- [ ] **Track filter-out review burden over time** — if drop count and your
      correction rate are not falling week over week, that is the signal the
      triage prompt needs work
- [ ] `emitReviewDocs` — writes the week's review set, then **the run completes**.
      No `interrupt()`; with feedback applied on the following run, pausing
      bought nothing but a resume that did no work.
- [ ] `pnpm review --week <week>` — parses inline annotations
      (`> verdict: keep` / `> verdict: drop` / free text) into `feedback`.
      **Reads from `data/artifacts/`** — the one thing flowing disk → Postgres,
      so it must run before re-rendering or clearing that directory.
- [ ] `ingestFeedback` at the head of the next run — few-shot examples appended
      to the triage and scoring prompts; accepted taxonomy proposals applied as
      a new `artifact_versions` row
- [ ] **Cap the few-shot selection** — most recent N plus any verdict that
      contradicted a high-confidence decision. Config value, measurable against
      the Phase 3 labeled set.
- [ ] Phase 6 migration: `feedback`
