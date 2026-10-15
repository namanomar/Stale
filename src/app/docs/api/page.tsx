import { Note, PageHead } from "@/components/docs/bits";

export const metadata = { title: "REST API · Stale docs" };

type Verb = "GET" | "POST" | "PATCH" | "DELETE";
interface Ep {
  verb: Verb;
  path: string;
  role: "viewer" | "member" | "admin";
  what: string;
}

const GROUPS: { id: string; title: string; blurb: string; rows: Ep[] }[] = [
  {
    id: "memory",
    title: "Memory",
    blurb: "The graph itself.",
    rows: [
      { verb: "GET", path: "/api/v1/graph", role: "viewer", what: "Nodes, edges, sources, tainted ids and stats. What the dashboard draws." },
      { verb: "POST", path: "/api/v1/nodes", role: "member", what: "Add a fact, belief, decision or action: { kind, content, dependsOn, sourceId }." },
      { verb: "GET", path: "/api/v1/nodes/:id", role: "viewer", what: "One node." },
      { verb: "POST", path: "/api/v1/nodes/:id/supersede", role: "member", what: "A fact changed. Versions it and cascades staleness." },
      { verb: "GET", path: "/api/v1/nodes/:id/impact", role: "viewer", what: "Blast radius, dry run." },
      { verb: "GET", path: "/api/v1/nodes/:id/why", role: "viewer", what: "Ancestry and firewall verdict." },
      { verb: "GET", path: "/api/v1/repair-plan", role: "viewer", what: "Stale nodes in root-first layers." },
      { verb: "POST", path: "/api/v1/nodes/:id/resolve", role: "member", what: "Revalidate and rebase a stale node." },
      { verb: "GET", path: "/api/v1/sources", role: "viewer", what: "List sources." },
      { verb: "POST", path: "/api/v1/sources", role: "member", what: "Register a source." },
      { verb: "POST", path: "/api/v1/sources/:id/trust", role: "member", what: "Quarantine or restore: { trust, reason }." },
      { verb: "GET", path: "/api/v1/events", role: "viewer", what: "The audit log." },
    ],
  },
  {
    id: "firewall",
    title: "Firewall and approvals",
    blurb: "Where a human overrides, and an agent cannot.",
    rows: [
      { verb: "GET", path: "/api/v1/actions/:id/check", role: "viewer", what: "Run the firewall. POST works too." },
      { verb: "POST", path: "/api/v1/actions/:id/approve", role: "member", what: "A human approves a blocked action: { approver, note }. Not available over MCP." },
      { verb: "POST", path: "/api/v1/actions/:id/execute", role: "member", what: "Record that the action ran. 403 if blocked and unapproved." },
    ],
  },
  {
    id: "learning",
    title: "Learning and review",
    blurb: "Feeding text in, and deciding on what’s risky.",
    rows: [
      { verb: "POST", path: "/api/v1/ingest", role: "member", what: "Feed any text. Returns added, confirmed, updated, queued." },
      { verb: "GET", path: "/api/v1/ingest", role: "viewer", what: "Recent ingest ledger." },
      { verb: "GET", path: "/api/v1/review", role: "viewer", what: "The review queue. Filter with ?status=pending." },
      { verb: "POST", path: "/api/v1/review/:id", role: "member", what: "Approve or reject a queued change: { decision: \"approved\" | \"rejected\" }." },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    blurb: "Connections to your tools.",
    rows: [
      { verb: "GET", path: "/api/v1/integrations", role: "viewer", what: "List, with their webhook addresses." },
      { verb: "POST", path: "/api/v1/integrations", role: "admin", what: "Create one. Secrets are encrypted and shown once." },
      { verb: "DELETE", path: "/api/v1/integrations/:id", role: "admin", what: "Remove one." },
      { verb: "GET", path: "/api/v1/integrations/:id/check", role: "viewer", what: "Test the credentials." },
      { verb: "GET", path: "/api/v1/integrations/:id/sync", role: "viewer", what: "List what can be synced (channels, repos, projects, pages)." },
      { verb: "POST", path: "/api/v1/integrations/:id/sync", role: "admin", what: "Import the chosen scope." },
    ],
  },
  {
    id: "workspace",
    title: "Workspace and access",
    blurb: "People, keys and settings.",
    rows: [
      { verb: "GET", path: "/api/workspace", role: "viewer", what: "Your workspace and role." },
      { verb: "PATCH", path: "/api/workspace", role: "admin", what: "Rename, or set settings.autoApply to trusted or never." },
      { verb: "GET", path: "/api/workspace/members", role: "viewer", what: "Members and roles." },
      { verb: "POST", path: "/api/workspace/members", role: "admin", what: "Add an existing user by email with a role." },
      { verb: "DELETE", path: "/api/workspace/members", role: "admin", what: "Remove a member: ?userId=…. A workspace keeps at least one admin." },
      { verb: "GET", path: "/api/workspace/keys", role: "admin", what: "List API keys (prefix only, never the secret)." },
      { verb: "POST", path: "/api/workspace/keys", role: "admin", what: "Create a key: { name }. The secret is shown once." },
      { verb: "DELETE", path: "/api/workspace/keys", role: "admin", what: "Revoke a key: ?id=…." },
    ],
  },
  {
    id: "billing",
    title: "Plans and billing",
    blurb: "Razorpay subscriptions. Only active when the server has Razorpay keys.",
    rows: [
      { verb: "GET", path: "/api/billing", role: "viewer", what: "Current plan, status, limits and this month’s usage." },
      { verb: "POST", path: "/api/billing/checkout", role: "admin", what: "Start an upgrade: { plan: \"team\", interval }. Returns what Razorpay Checkout needs." },
      { verb: "POST", path: "/api/billing/verify", role: "admin", what: "Confirm a finished payment by its Razorpay signature, then switch the plan on." },
      { verb: "POST", path: "/api/billing/cancel", role: "admin", what: "Stop renewing. The plan stays on until the paid period ends." },
    ],
  },
  {
    id: "system",
    title: "System",
    blurb: "Health and demo helpers.",
    rows: [
      { verb: "GET", path: "/api/v1/health", role: "viewer", what: "Is the memory database reachable?" },
      { verb: "POST", path: "/api/v1/demo/seed", role: "member", what: "Wipe the workspace graph and load the demo scenarios." },
      { verb: "POST", path: "/api/v1/sample", role: "admin", what: "Load the “Northwind Robotics” sample story into this workspace, streaming progress. Safe to run twice." },
      { verb: "DELETE", path: "/api/v1/tenant", role: "member", what: "Delete this workspace’s memory graph." },
    ],
  },
];

const roleTone: Record<Ep["role"], string> = { viewer: "good", member: "warn", admin: "bad" };

export default function Api() {
  return (
    <>
      <PageHead
        kicker="Build with Stale"
        title="REST API"
        lead="Everything the dashboard does, you can do with curl. Same auth, same roles, same results."
      />

      <h2 id="auth">Authentication</h2>
      <p>Send an API key on every request:</p>
      <div className="code">{`Authorization: Bearer sk_YOUR_KEY`}</div>
      <p>Browsers use a session cookie instead, set when you sign in. A key belongs to one workspace and acts with the <b>member</b> role, so admin-only endpoints (marked below) need a signed-in admin.</p>
      <h3>Roles</h3>
      <div className="dx-table-wrap"><table className="dx-table"><tbody>
        <tr><td><span className="dx-pill good">viewer</span></td><td>Read-only. Every GET.</td></tr>
        <tr><td><span className="dx-pill warn">member</span></td><td>Everything a viewer can do, plus writes: remember, ingest, resolve, approve, integrations.</td></tr>
        <tr><td><span className="dx-pill bad">admin</span></td><td>Everything, plus members, API keys and workspace settings.</td></tr>
      </tbody></table></div>
      <Note kind="tip">A request below your role gets <code>403</code>. Going over a plan limit returns <code>402</code>. A missing or wrong key gets <code>401</code>.</Note>

      <h2 id="conventions">Conventions</h2>
      <ul className="plain">
        <li>Bodies and responses are JSON. Bodies are validated, and bad input returns <code>400</code> with <code>details</code>.</li>
        <li>Errors look like <code>{`{ "error": "…", "details": … }`}</code>.</li>
        <li><code>404</code> not found · <code>409</code> conflict (e.g. building on a stale node) · <code>503</code> the memory database is unreachable.</li>
        <li>Ids are up to 64 characters: letters, digits and <code>_ . : -</code>.</li>
      </ul>

      <h2 id="example">A full example</h2>
      <p>Teach it a fact, change it, and see what went stale:</p>
      <div className="code">{`# 1. register a source
curl -X POST $HOST/api/v1/sources -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"id":"src_sales","name":"Sales call","trust":"trusted"}'

# 2. a fact, and something built on it
curl -X POST $HOST/api/v1/nodes -H "Authorization: Bearer $KEY" -H "content-type: application/json" \\
  -d '{"id":"f_price","kind":"fact","content":"Renewal price is $9,000","sourceId":"src_sales"}'
curl -X POST $HOST/api/v1/nodes -H "Authorization: Bearer $KEY" -H "content-type: application/json" \\
  -d '{"id":"d_quote","kind":"decision","content":"Quote Acme at $9,000","dependsOn":["f_price"]}'

# 3. the price changes
curl -X POST $HOST/api/v1/nodes/f_price/supersede -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" -d '{"content":"Renewal price is $12,000"}'

# 4. what do I fix?
curl $HOST/api/v1/repair-plan -H "Authorization: Bearer $KEY"`}</div>

      <h2 id="endpoints">All endpoints</h2>
      {GROUPS.map((g) => (
        <section key={g.id}>
          <h3 id={g.id}>{g.title}</h3>
          <p className="muted">{g.blurb}</p>
          <div className="dx-table-wrap"><table className="dx-table">
            <thead><tr><th>Endpoint</th><th>Role</th><th>What it does</th></tr></thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.verb + r.path}>
                  <td><span className={`verb ${r.verb.toLowerCase()}`}>{r.verb}</span> <code>{r.path}</code></td>
                  <td><span className={`dx-pill ${roleTone[r.role]}`}>{r.role}</span></td>
                  <td>{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      ))}

      <h2 id="hooks">Inbound webhooks</h2>
      <p>These authenticate with the integration’s own secret instead of an API key:</p>
      <div className="dx-table-wrap"><table className="dx-table"><tbody>
        <tr><td><span className="verb post">POST</span> <code>/api/hooks/slack/:id</code></td><td>Slack Events API. Requests must carry a valid Slack signature.</td></tr>
        <tr><td><span className="verb post">POST</span> <code>/api/hooks/email/:id</code></td><td>Forwarded or parsed email. Header <code>x-stale-secret</code>.</td></tr>
        <tr><td><span className="verb post">POST</span> <code>/api/hooks/razorpay</code></td><td>Razorpay subscription events (renewals, failures, cancellations). Signed with your webhook secret.</td></tr>
        <tr><td><span className="verb post">POST</span> <code>/api/hooks/generic/:id</code></td><td>Any JSON: <code>{`{ source, author, text }`}</code>. Header <code>x-stale-secret</code>.</td></tr>
      </tbody></table></div>
    </>
  );
}
