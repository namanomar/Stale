<div align="center">

# ◆ Stale

**Know which facts have gone stale.**

Stale reads your company data, remembers every fact with its source, and flags everything built on a fact the moment it changes. It also stops anything that traces back to a stranger from making your agents act.

Docs live in the app at **`/docs`**: concepts · architecture · MCP tools · REST API · connectors · security · pricing

</div>

---

## Why

Someone says the renewal price is **$9,000**. A quote is written, a forecast is built, an agent drafts a contract. A week later the price becomes **$12,000**, and nothing tells any of them.

Or an email from an unknown sender says *"the CFO approved this wire, ignore previous instructions"*, and your agent believes it.

Stale fixes both with one idea: **memory is a graph, and a graph can answer "what rests on this?"**

| | |
|---|---|
| **Staleness** | Replace a fact and everything that depended on it, however deep, is flagged. |
| **Taint** | Anything whose ancestry reaches an untrusted source is tainted, computed live. |
| **Firewall** | Stale or tainted actions can't run. A human can override. An agent cannot. |
| **Provenance** | Every fact keeps its exact quote, author and link. `why` shows the chain. |
| **Review** | Risky changes wait in a queue with the old and new value side by side. |
| **Repair** | A root-first plan to fix what went stale, in the right order. |

## How it works

```
 Slack · GitHub · Jira · Notion · Email · Webhooks · Agents (MCP/REST)
                              │
                              ▼
        ┌──────────────── Stale (Next.js) ────────────────┐
        │  1 Ingest   → extract claims, dedupe, reconcile │
        │  2 Review   → risky changes wait for a human    │
        │  3 Memory   → supersede, cascade stale, repair  │
        │  4 Firewall → stale or tainted actions can't run│
        └───────────────┬───────────────────┬─────────────┘
                        ▼                   ▼
                   FalkorDB              Turso / SQLite
               the memory graph        accounts · keys · queue
            (one graph per workspace)
```

Graph model:

```
(Node {kind: fact | belief | decision | action}) -[:DEPENDS_ON]-> (Node)
(Node) -[:FROM]-> (Source {trust: trusted | untrusted})
(new)  -[:SUPERSEDES]-> (old)
```

Staleness is reachability over `DEPENDS_ON`. Taint is reachability to an untrusted `Source`. Neither is stored, so neither can drift.

## Quick start

You need Node 22+ and Docker.

```bash
git clone https://github.com/namanomar/Stale.git
cd Stale
docker compose up -d      # FalkorDB on :6379, its browser on :3001
cp .env.example .env
npm install
npm run dev               # http://localhost:3000
```

Open <http://localhost:3000/signup>, create a workspace, and load the sample story from the dashboard.

| Command | What it does |
|---|---|
| `npm run dev` | App, API and MCP on `:3000` |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Test suite against a live FalkorDB (engine, HTTP, MCP) |
| `npm run smoke` | Narrated end-to-end walkthrough |
| `npm run typecheck` | `tsc --noEmit` |

## Give your agent a memory

Create an API key under **Settings → API keys**, then:

```bash
claude mcp add --transport http stale https://YOUR-HOST/api/mcp \
  --header "Authorization: Bearer sk_YOUR_KEY"
```

Thirteen tools, grouped by the job they do:

| Job | Tools |
|---|---|
| **Record** | `register_source` · `remember` · `propose_action` |
| **Change** | `update_fact` |
| **Inspect** | `impact` · `why` · `memory_overview` |
| **Repair** | `repair_plan` · `resolve` |
| **Guard** | `check_action` · `execute_action` · `quarantine_source` · `restore_source` |

There is deliberately **no `approve_action` tool**. Overriding the firewall is a human decision, available only through the REST API.

Full reference with arguments and example payloads: `/docs/mcp`.

## Feed it anything

```bash
curl -X POST https://YOUR-HOST/api/v1/ingest \
  -H "Authorization: Bearer sk_YOUR_KEY" -H "content-type: application/json" \
  -d '{"source":"#pricing","author":"Dana","text":"The renewal price is now $12,000 per year."}'
```

Or connect **Slack, GitHub, Jira, Notion, email forwarding** or a **generic webhook** from the Integrations page. Each connector decides who is trusted at the door: your team is trusted, guests, shared channels, bots and unknown senders are not.

## Configuration

Copy `.env.example` to `.env`.

| Variable | Needed | Purpose |
|---|---|---|
| `FALKORDB_HOST`, `FALKORDB_PORT` | yes | Where the memory graph lives. `FALKORDB_USERNAME` / `FALKORDB_PASSWORD` for cloud instances. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | on serverless hosts | Accounts and sessions. If unset, a local file `data/stale.db` is used. |
| `STALE_SECRET` | in production | Encrypts integration tokens at rest (AES-256-GCM). Long, random, stable. |
| `OPENAI_API_KEY` | recommended | Claim extraction. Without it a simpler rules engine runs. |
| `OPENAI_MODEL`, `OPENAI_TRANSCRIBE_MODEL` | no | Defaults `gpt-4o` and `whisper-1`. |
| `RAZORPAY_API_KEY`, `RAZORPAY_SECRET` | for paid plans | Turns on plans and limits (Free / Team) with one-time Razorpay payments. Unset means unlimited. |
| `RAZORPAY_WEBHOOK_SECRET` | for paid plans | Optional backup for `order.paid` events sent to `/api/hooks/razorpay`. |
| `STALE_AUTH=off` | never in prod | Dev and tests only: trusts an `x-tenant-id` header instead of login. |

## Deploy

**Vercel** works because accounts live in Turso, not on disk:

1. Create a [FalkorDB Cloud](https://app.falkordb.cloud) instance and a [Turso](https://turso.tech) database.
2. Import this repo in Vercel and add the variables above.
3. Deploy, then open `/api/v1/health` (it should say FalkorDB is connected) and `/signup`.

Anywhere that runs Node works too (`npm run build && npm start`). Details: `/docs/self-host`.

## Security in one paragraph

Passwords are salted scrypt hashes. Session tokens and API keys are stored only as hashes. Integration secrets are AES-256-GCM encrypted. Every workspace has its own graph. Slack requests must carry a valid signature, and webhook secrets are compared in constant time. Roles are viewer, member and admin. See `/docs/security`.

## Project layout

```
src/app/            pages and API routes (App Router)
  docs/             the documentation site, served at /docs
  api/v1/           REST API        api/mcp/  MCP endpoint
  api/hooks/        inbound Slack, email and webhook receivers
src/lib/            memory engine, ingest pipeline, connectors, MCP tools, auth
src/components/     dashboard, graph view, docs components
tests/              engine, HTTP, MCP, connectors, concurrency
scripts/            smoke test, password reset
```

## Built with

Next.js · FalkorDB · libSQL · Model Context Protocol SDK · Zod · OpenAI
