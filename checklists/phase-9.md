# Phase 9 — Web frontend (deferred)

Local Next.js reader over the same Postgres:

- Articles, summaries, and artifacts with a text-to-speech function
- Version-to-version diffs of the aggregations rendered from `artifact_versions`
- Simplified run timeline linking into Langfuse for full traces
- Feedback widgets replacing the markdown annotation flow

Because Postgres is already the source of truth and disk is only a rendered
view, this phase adds a second *view* rather than a second storage path.

*Expand into granular tasks when reached.*
