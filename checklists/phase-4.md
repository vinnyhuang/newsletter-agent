# Phase 4 — Fetch and summarize (PRD step 3.2)

**Exit check:** `--until summarize` gives a week of stories with stored raw HTML,
extracted text, and summaries in Postgres, plus token totals in Langfuse.
Dropping `data/` entirely and re-rendering loses nothing.

*Expand into granular tasks when reached.*

---

- [ ] `content/fetchArticle.ts` — undici with a real user agent and timeout,
      `@mozilla/readability` + `jsdom` for extraction
- [ ] **Persist both raw HTML and extracted text.** Raw HTML is what lets you
      re-extract when extraction fails or the extractor improves — cheap now,
      impossible once the URL rots.
- [ ] Blurb-derived fallback on extraction failure, marked as such rather than
      silently degrading
- [ ] `summarizeStory` agent (Sonnet 5) — 1–6 paragraphs sized to the story,
      prompted to preserve numbers, names, and concrete claims over generic
      framing
- [ ] **Key `articles` and `summaries` to the global `story_unit`, not the run**
      — this is what lets a later week's "Previously covered" entry link to a
      summary written weeks earlier
- [ ] Both steps inside one `processStory` node, so a failed fetch or summary
      retries as one unit
- [ ] Phase 4 migration: `articles`, `summaries`
