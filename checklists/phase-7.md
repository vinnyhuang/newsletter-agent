# Phase 7 — Evals and cost

*Expand into granular tasks when reached.*

---

- [ ] Extend the Phase 3 triage dataset into Langfuse datasets covering scoring
      and routing, built from accumulated feedback verdicts
- [ ] Test whether `claude-haiku-4-5` matches Sonnet on **segmentation** against
      the golden files (Haiku is not a triage candidate)
- [ ] Re-test the triage tier against the labeled set, reading overall and
      per-class agreement together
- [ ] Token and rate-limit report per run and per step from `agent_calls`,
      surfaced in the meta doc. Reported USD included as a relative signal with
      the subscription-auth caveat noted inline so it is not read as spend.
- [ ] **Decide on per-step concurrency from collected `queue_wait_ms` data** —
      deliberately deferred from P0-7 rather than guessed
- [ ] Candidate refinements, driven by observed misses rather than scheduled:
  - Recurrence escalation — an agent call comparing a recurring story's new
    blurb against its stored summary, if flat dedupe is burying developments
  - Section-scoped aggregation edits, if the rewrite guard proves necessary
