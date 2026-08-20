# Phase 1 — Ingest and normalize (PRD steps 1–2)

**Exit check:** `pnpm pipeline --week 2026-W32 --until ingest` stores the week's
emails with clean markdown, zero model tokens spent. **Record the actual email
count** — this replaces the first half of the plan's volume estimates.

*Expand into granular tasks when reached.*

---

- [ ] Bring up the Gmail MCP server in Docker Desktop's MCP Toolkit
  - `docker mcp catalog show` to confirm a Gmail entry; if absent, pin a
    read-only Gmail MCP image with `gmail.readonly` scope only and desktop
    OAuth credentials mounted from `~/.gmail-mcp`
  - **Risk:** the catalog entry may expose only thread-level reads or lack
    full-body retrieval. Verify tool shapes before building on them.
- [ ] `src/mcp/gmailClient.ts` — MCP stdio client (`Client` +
      `StdioClientTransport` over `docker mcp gateway run --servers gmail`).
      Keep the server config object reusable as an Agent SDK `mcpServers` entry.
- [ ] `config/senders.ts` — sender → A|B map
- [ ] `ingestEmails` node — one Gmail query per sender scoped to the week;
      store raw HTML plus cleaned markdown (cheerio to strip tracking pixels
      and boilerplate, turndown to markdown), keyed by `gmail_message_id`
- [ ] `classifyNewsletterType` node — pure sender-map lookup, with an explicit
      unknown-sender path that logs for review rather than guessing
- [ ] Phase 1 migration: `newsletters`, `emails`
- [ ] Exit check + record real email count
