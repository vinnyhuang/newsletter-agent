# Phase 5 — Score, route, and write (PRD steps 3.2.4–4)

**Exit check:** a week's reading list, three digests, updated aggregations, and
per-aggregation change notes — all in `artifact_versions` and rendered under
`data/artifacts/`. `pnpm render --week 2026-W32` on an empty `data/` reproduces
the tree byte-for-byte.

*Expand into granular tasks when reached.*

---

- [ ] `scoreAndRoute` agent (Sonnet 5) — **one call over all of the week's
      summaries**, so stories are ranked against each other rather than judged
      in isolation. Returns per-story `{ relevanceScore, qualityScore,
      confidence, recommendation, digestStreams, aggregations }`.

Everything after `scoreAndRoute` **fans out** — mutually independent, reads from
Postgres, writes to disjoint `artifact_versions` rows:

- [ ] `writeReadingList` — deterministic render, no agent. Grouped by topic,
      ordered by score. Includes a **"Previously covered"** section for
      recurrences with links back. The catch-all: topics with no digest stream
      would otherwise have no readable home.
- [ ] `writeDigestStreams` — one agent call per stream, 1,200–2,500 words each
- [ ] `updateAggregations` — returns `{ document, changeSummary, sectionsTouched }`
- [ ] **Rewrite guard** — diff the returned document against the prior
      `artifact_versions` row; **fail the step** if it removed more than a
      threshold share of lines without `changeSummary` declaring a removal.
      A failed step leaves the previous version intact.
- [ ] Render `aggregation-changes.md` from `changeSummary` + computed diff stats
- [ ] Phase 5 migration: `scores`, `digest_streams`, `digest_items`,
      `aggregations`
- [ ] `pnpm render` CLI — regenerate the whole `data/` tree from Postgres
