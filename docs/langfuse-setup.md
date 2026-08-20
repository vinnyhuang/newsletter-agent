# Langfuse setup

Tracing runs as a **separate self-hosted deployment outside this repo**, with its own
Postgres, Clickhouse, Redis and MinIO. Nothing here depends on it: with the Langfuse
variables blank, `langfuseEnabled` is false and tracing no-ops.

Verified against Langfuse **v4** (`langfuse/langfuse:4`).

## One-time setup

### 1. Clone, outside this repo

```bash
cd ~/Documents      # anywhere that is not newsletter-agent
git clone https://github.com/langfuse/langfuse.git
cd langfuse
```

### 2. Resolve port collisions

Langfuse's compose publishes ports that commonly clash, and two of them bind `0.0.0.0`
rather than loopback. Check what yours does before starting it:

```bash
docker compose config | grep -B 6 'published:'
```

Defaults at the time of writing:

| Service | Publishes | Note |
|---|---|---|
| `langfuse-web` | `3000` | **no `host_ip`** — exposed to the network |
| `langfuse-worker` | `127.0.0.1:3030` | do not reuse 3030 for the web UI |
| `postgres` | `127.0.0.1:5432` | clashes with a local Postgres |
| `minio` | `9090`, `127.0.0.1:9091` | 9090 has **no `host_ip`** |
| `clickhouse`, `redis` | loopback | fine |

Fix with `docker-compose.override.yml` **in the Langfuse clone** — Compose loads it
automatically, and it leaves their tracked file clean for `git pull`:

```yaml
services:
  langfuse-web:
    # !override REPLACES the port list. A plain list would MERGE, leaving 3000
    # published alongside 3100 and the collision unresolved.
    ports: !override
      - '127.0.0.1:3100:3000'
    environment:
      # Login redirects are built from this. Remap the port without it and you
      # sign in successfully, then get bounced to a dead localhost:3000.
      NEXTAUTH_URL: http://localhost:3100

  postgres:
    # Nothing outside the compose network needs it.
    ports: !reset []

  minio:
    ports: !override
      - '127.0.0.1:9090:9000'
      - '127.0.0.1:9091:9001'
```

`ports` is one of the fields Compose **concatenates** rather than replaces, so
`!override` is load-bearing. Confirm before starting:

```bash
docker compose config | grep -E 'published:|host_ip:|NEXTAUTH_URL'
```

### 3. Start it

```bash
docker compose up -d
docker compose ps          # web + worker healthy, ~1-2 min on first run
```

### 4. Account and keys

Open <http://localhost:3100>. Sign up — the first account owns the instance, and
credentials stay local. Create an organisation, then a project, then
**Settings → API Keys → Create**. The pair is shown once.

### 5. Point this repo at it

In `.env`:

```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://localhost:3100
```

`LANGFUSE_BASE_URL` matches the name the Langfuse SDK reads itself, so
`LangfuseSpanProcessor` picks all three up with no explicit configuration.

## Everyday use

```bash
cd ~/Documents/langfuse
docker compose up -d     # start
docker compose down      # stop; data survives
docker compose down -v   # destroys traces AND your account
```

## How tracing is wired here

`src/observability/instrumentation.ts` exposes `startObservability()` and
`shutdownObservability()`, called by CLI entry points — **not** run as an import side
effect, so importing it in a test never opens an exporter.

`shutdownObservability()` is required before a CLI exits: the processor batches, and a
process that exits without flushing loses the trace for the work it just did.

`src/observability/agentSdk.ts` exists because of an ESM constraint. Module exports are
read-only getters, so the OpenTelemetry instrumentation cannot patch `query` in place —
it returns a *new* module object instead. Anything holding a direct
`import { query } from '@anthropic-ai/claude-agent-sdk'` would keep calling the
unpatched function and emit no spans. Callers use `agentQuery` so the handle can be
swapped once at startup.

`runAgent` opens its own span per call, which parents the instrumentation's spans and
supplies the trace id stored on `agent_calls.langfuse_trace_id`. A trace looks like:

```
SPAN   agent.<name>          ← ours
AGENT  ClaudeAgent.query     ← @arizeai/openinference-instrumentation-claude-agent-sdk
TOOL   StructuredOutput      ← the end-turn tool backing json_schema output
```

## Reading traces from the API

Langfuse v4 runs in "events_only" mode, and the v3 endpoints are gone —
`GET /api/public/traces` returns **404** with a deprecation notice. Use:

```bash
set -a; . ./.env; set +a
FROM=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ); TO=$(date -u -v+1H +%Y-%m-%dT%H:%M:%SZ)
curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "$LANGFUSE_BASE_URL/api/public/v2/observations?fromStartTime=$FROM&toStartTime=$TO&limit=10"
```
