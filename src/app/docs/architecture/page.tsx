import { Note, PageHead } from "@/components/docs/bits";

export const metadata = { title: "Architecture · Stale docs" };

export default function Architecture() {
  return (
    <>
      <PageHead
        kicker="Under the hood"
        title="Architecture"
        lead="One Next.js app, two databases, and a very strict rule about who is allowed to make an action happen."
      />

      <h2 id="map">The whole map</h2>
      <div className="arch">
        <svg viewBox="0 0 920 440" role="img" aria-label="Stale architecture: inputs flow into the Stale app, which stores the graph in FalkorDB and accounts in Turso">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" />
            </marker>
          </defs>

          <text className="sm" x="20" y="22">WHERE WORK HAPPENS</text>
          {["Slack", "GitHub · Jira · Notion", "Email forwarding", "Webhook · REST API", "Agents (MCP)"].map((t, i) => (
            <g key={t}>
              <rect className="box" x="20" y={36 + i * 72} width="190" height="52" rx="8" />
              <text x="38" y={67 + i * 72}>{t}</text>
              <path className="wire flow" d={`M210 ${62 + i * 72} C 260 ${62 + i * 72}, 250 220, 300 220`} markerEnd="url(#ah)" />
            </g>
          ))}

          <text className="sm" x="300" y="22">THE STALE APP (NEXT.JS)</text>
          <rect className="box" x="300" y="36" width="300" height="368" rx="12" strokeDasharray="2 0" />
          <rect className="box hot" x="320" y="58" width="260" height="62" rx="8" />
          <text className="on" x="336" y="84">1 · Ingest</text>
          <text className="sm on" x="336" y="104" style={{ fill: "var(--on-marker)" }}>extract claims, dedupe, reconcile</text>
          <rect className="box" x="320" y="138" width="260" height="62" rx="8" />
          <text x="336" y="164">2 · Review queue</text>
          <text className="sm" x="336" y="184">risky changes wait for a human</text>
          <rect className="box" x="320" y="218" width="260" height="62" rx="8" />
          <text x="336" y="244">3 · Memory engine</text>
          <text className="sm" x="336" y="264">supersede, cascade stale, repair</text>
          <rect className="box bad" x="320" y="298" width="260" height="62" rx="8" />
          <text x="336" y="324">4 · Taint firewall</text>
          <text className="sm" x="336" y="344">stale or tainted actions can’t run</text>
          <text className="sm" x="320" y="388">Auth · roles · API keys · MCP · REST</text>

          <path className="wire" d="M600 90 C 650 90, 650 150, 690 150" markerEnd="url(#ah)" />
          <path className="wire" d="M600 250 C 650 250, 650 150, 690 150" markerEnd="url(#ah)" />
          <path className="wire" d="M600 170 C 650 170, 650 330, 690 330" markerEnd="url(#ah)" />

          <text className="sm" x="690" y="22">STORAGE</text>
          <rect className="box db" x="690" y="60" width="210" height="130" rx="10" />
          <text x="708" y="92">FalkorDB</text>
          <text className="sm" x="708" y="114">the memory graph</text>
          <text className="sm" x="708" y="134">nodes · sources · edges</text>
          <text className="sm" x="708" y="154">one graph per workspace</text>
          <rect className="box db" x="690" y="250" width="210" height="130" rx="10" />
          <text x="708" y="282">Turso (libSQL)</text>
          <text className="sm" x="708" y="304">the control plane</text>
          <text className="sm" x="708" y="324">accounts · sessions · keys</text>
          <text className="sm" x="708" y="344">review queue · ingest ledger</text>
        </svg>
      </div>
      <p>The app is stateless. Every request is authenticated, scoped to one workspace, and then reads or writes that workspace’s graph. You can run many copies of it behind a load balancer, which is exactly what Vercel does.</p>

      <h2 id="two-stores">Why two databases?</h2>
      <p>They hold different kinds of truth, so they use different kinds of database.</p>
      <div className="dx-table-wrap"><table className="dx-table">
        <thead><tr><th>Store</th><th>Holds</th><th>Why this one</th></tr></thead>
        <tbody>
          <tr><td><b>FalkorDB</b></td><td>Facts, beliefs, decisions, actions, sources and the edges between them.</td><td>Staleness and taint are graph questions (“what can I reach from here?”). A graph database answers them in one query instead of many.</td></tr>
          <tr><td><b>Turso / SQLite</b></td><td>Users, password hashes, sessions, API keys, integrations, review items, ingest ledger.</td><td>Plain relational data with constraints, and a free hosted tier. Locally it falls back to a file, so there is nothing to set up.</td></tr>
        </tbody>
      </table></div>
      <Note>Each workspace gets its own graph, so one customer’s memory can never be reached through another’s query.</Note>

      <h2 id="graph">The graph model</h2>
      <p>Three kinds of edges, and that is all:</p>
      <div className="code">{`(Node {kind: fact | belief | decision | action})
   -[:DEPENDS_ON]-> (Node)      what this was built on
(Node) -[:FROM]->  (Source {trust})   where a fact came from
(new)  -[:SUPERSEDES]-> (old)        a fact was replaced`}</div>
      <p><b>Staleness</b> is reachability over <code>DEPENDS_ON</code>. <b>Taint</b> is reachability to an untrusted <code>Source</code>. Both are computed when you ask, not stored, so they can never drift out of date.</p>

      <h2 id="journey">One message, start to finish</h2>
      <p>Follow a single email through the system.</p>
      <div className="pipe">
        <div><b>It arrives</b><span>A connector (here, email forwarding) turns the raw message into a common shape: text, author, source, and a verdict on whether the sender is outside the company.</span></div>
        <div><b>Duplicates are dropped</b><span>Each message has an external id (an email message-id, a Slack timestamp). The ingest ledger remembers which ones were seen, so retries and replays do nothing.</span></div>
        <div><b>Claims are extracted</b><span>An LLM reads the text and returns structured claims with the exact quote and a confidence. If no OpenAI key is set, a rules engine does a simpler pass.</span></div>
        <div><b>Each claim is reconciled</b><span>It is compared with existing facts: the same (confirm), new (add), or contradicting (supersede).</span></div>
        <div><b>Risky changes are queued</b><span>A stranger, low confidence, or a possible conflict goes to the review queue instead of changing memory.</span></div>
        <div><b>Memory is updated</b><span>Safe changes are applied. A superseded fact turns everything that depended on it stale, and the response lists the impact, including actions already taken.</span></div>
        <div className="stop"><b>The firewall guards actions</b><span>Later, an agent proposes “wire $48,000”. Its ancestry reaches the stranger’s email, so it is tainted and blocked. The check returns the exact path.</span></div>
      </div>

      <h2 id="request">How a request is handled</h2>
      <ol>
        <li><b>Authenticate.</b> A browser session cookie, or <code>Authorization: Bearer sk_…</code>.</li>
        <li><b>Authorize.</b> The role must be high enough: viewer for reads, member for writes, admin for keys and settings.</li>
        <li><b>Open the workspace graph.</b> The graph name comes from the workspace id, never from the request body.</li>
        <li><b>Validate input.</b> Every body is checked against a schema before anything touches the database.</li>
        <li><b>Respond uniformly.</b> Errors are JSON with a status and details. If FalkorDB is down you get a clear 503, not a hang.</li>
      </ol>

      <h2 id="stack">The stack</h2>
      <ul className="plain">
        <li><b>Next.js</b> (App Router) serves the website, the REST API and the MCP endpoint from one deployment.</li>
        <li><b>FalkorDB</b> for the graph, <b>libSQL</b> for the control plane.</li>
        <li><b>Model Context Protocol</b> SDK for the agent interface, over streamable HTTP and stateless: a fresh server per request.</li>
        <li><b>OpenAI</b> for claim extraction and audio transcription (optional; there is a rules fallback).</li>
        <li><b>Zod</b> for validating every input.</li>
      </ul>
    </>
  );
}
