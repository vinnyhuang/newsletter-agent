# Phase 2 — Story unit segmentation, dedupe, recurrence (PRD step 2)

**Exit check:** `--until segment` yields a deduped story unit list you can
eyeball against the source emails, with sponsor drops and recurrence hits
reported as counts. **Record the actual unique story-unit count** — this gates
the Phase 3 tier decision.

*Expand into granular tasks when reached.*

---

- [ ] `segmentStories` agent (Sonnet 5) — one call per List A email, returns
      `{ stories: [{ title, blurb, url, sectionLabel, isSponsored }] }`
- [ ] Deterministic sponsor filter — sponsored blocks are **tagged then dropped**,
      not silently swallowed, so golden tests can assert on detection and a
      regression that flags real content shows up in the counts
- [ ] `content/canonicalUrl.ts` — follow tracker redirects (beehiiv, substack,
      `link.mail.*`) with capped redirects and a timeout, strip `utm_*`, hash
      to a `dedupe_key`
- [ ] `canonicalizeAndDedupe` node — collapse duplicates into one `story_units`
      row with multiple `story_sources`, preserving each newsletter's blurb.
      **Keys are global, so this also collapses against prior weeks.**
- [ ] `recordRecurrence` node — apply the deterministic prior-week table
      (kept before → "Previously covered"; dropped before → silent re-drop,
      logged). No model call.
- [ ] Phase 2 migration: `story_units` (unique on `dedupe_key`), `story_sources`
- [ ] Golden-file fixtures: several real emails per List A newsletter; assert
      segment counts, URLs, sponsor flags
- [ ] Exit check + record real unique story-unit count
