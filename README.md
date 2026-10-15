# Stale

Truth maintenance + taint firewall for agent memory, on FalkorDB. One graph per tenant.

```
docker compose up -d      # FalkorDB on :6379, browser on :3001
cp .env.example .env
npm run dev               # API + MCP on :3000
npm test                  # 115 tests against live FalkorDB (engine, HTTP, MCP, fuzz)
npm run smoke             # narrated end-to-end walkthrough
```

Tenant: `x-tenant-id` header or `?tenant=` (default `demo`). Optional `STALE_API_KEY` bearer auth.

## Graph model
`(Node {kind: fact|belief|decision|action})-[:DEPENDS_ON]->(Node)`, `(Node)-[:FROM]->(Source {trust})`,
`(new)-[:SUPERSEDES]->(old)`. Staleness = reachability over DEPENDS_ON; taint = reachability to an untrusted Source (computed live).

## REST (`/api/v1`)
| | |
|---|---|
| `POST demo/seed` | wipe tenant, load launch + poisoned-email scenarios |
| `GET graph` | nodes, edges, sources, tainted ids, stats (for the UI) |
| `POST sources` / `POST sources/:id/trust` | register; quarantine/restore `{trust, reason}` |
| `POST nodes` | add fact/belief/decision/action `{kind, content, dependsOn, sourceId}` |
| `POST nodes/:id/supersede` | fact changed: version it, cascade stale |
| `GET nodes/:id/impact`, `GET nodes/:id/why` | blast radius / ancestry + verdict |
| `GET repair-plan`, `POST nodes/:id/resolve` | root-first repair layers; revalidate + rebase |
| `POST actions/:id/check\|approve\|execute` | firewall; approve is human-only |
| `GET events` | audit log |

## MCP
`/api/mcp?tenant=demo` (streamable HTTP, stateless):
`claude mcp add --transport http stale "http://localhost:3000/api/mcp?tenant=demo"`
No approve tool is exposed on purpose.
