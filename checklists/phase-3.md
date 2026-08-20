# Phase 3 — Triage and taxonomy (PRD step 3.1)

Triage determines what you never see, so it gets the strongest justified model
and its evaluation harness is built here rather than deferred.

**Exit check:** `--until triage` produces a filter-out doc plus topic assignments
for a real week; the suite reports per-class agreement against your labels;
interrupting mid-fan-out and resuming re-triages only the incomplete units.

*Expand into granular tasks when reached.*

---

- [ ] Taxonomy in `artifact_versions` (`kind: 'taxonomy'`), mirrored into
      `topics` on load with `parent_id` for AI Technical Area sub-categories.
      Renders to `taxonomy.md` for hand-editing; `pnpm review` reads edits back.
- [ ] `triageStory` agent — **Sonnet 5 with thinking**. Output
      `{ topics, keep, reason, confidence, taxonomyGap? }`.
      **Neutral prompt — no instruction to lean toward keeping.**
- [ ] `Send` fan-out from a conditional edge over new story units, bounded by
      the global semaphore, each unit wrapped in `withStep`
- [ ] `recordTaxonomyProposal` — writes a `proposals` row, tags the story with a
      provisional topic so downstream digest writing is not blind to it
- [ ] Render `filtered-out.md` **sorted lowest-confidence first**, and
      `proposals.md`
- [ ] Phase 3 migration: `topics`, `story_topics`, `classifications`,
      `proposals`, `artifact_versions`
- [ ] **Hand-label 30–50 story units** from a real week; `vitest` suite mirrored
      into a Langfuse dataset; report agreement overall **and per class**
- [ ] **Tier decision gate** — if agreement is below tolerance, or lopsided
      enough between classes to concern you, switch to `claude-opus-5` and
      re-run before proceeding. Tier is fixed thereafter regardless of volume.
