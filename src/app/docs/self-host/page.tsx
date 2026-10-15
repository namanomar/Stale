import { Note, PageHead, Steps } from "@/components/docs/bits";
import { CopyBlock } from "@/components/ui";

export const metadata = { title: "Self-hosting · Stale docs" };

const ENV = `# Memory graph
FALKORDB_HOST=your-instance.falkordb.cloud
FALKORDB_PORT=6379
FALKORDB_USERNAME=
FALKORDB_PASSWORD=

# Accounts and sessions (libSQL). Leave unset to use the file data/stale.db
TURSO_DATABASE_URL=libsql://your-db-your-org.turso.io
TURSO_AUTH_TOKEN=

# Encrypts integration tokens at rest. Long, random, stable.
STALE_SECRET=

# Claim extraction (optional: without it a simpler rules engine is used)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o

# Billing (optional). Without these there are no plan limits.
RAZORPAY_API_KEY=rzp_test_...
RAZORPAY_SECRET=
RAZORPAY_WEBHOOK_SECRET=`;

export default function SelfHost() {
  return (
    <>
      <PageHead
        kicker="Build with Stale"
        title="Self-hosting"
        lead="Stale is one Next.js app and two databases. Run it on your laptop in a minute, or on Vercel in ten."
      />

      <h2 id="local">Run it locally</h2>
      <Steps>
        <li><b>Start FalkorDB</b>Docker is the easy way.<CopyBlock text="docker compose up -d      # FalkorDB on :6379, its browser on :3001" /></li>
        <li><b>Configure</b>Copy the example env file. The defaults work locally.<CopyBlock text="cp .env.example .env" /></li>
        <li><b>Start the app</b><CopyBlock text={"npm install\nnpm run dev      # http://localhost:3000"} /></li>
      </Steps>
      <p>Accounts are stored in <code>data/stale.db</code> (a SQLite file). Open <code>/signup</code> and you’re in. Optional: <code>npm test</code> runs the suite against a live FalkorDB, and <code>npm run smoke</code> runs a narrated end-to-end walkthrough.</p>

      <h2 id="env">Environment variables</h2>
      <CopyBlock text={ENV} />
      <div className="dx-table-wrap"><table className="dx-table">
        <thead><tr><th>Variable</th><th>Needed?</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><code>FALKORDB_*</code></td><td>Yes</td><td>Where the memory graph lives.</td></tr>
          <tr><td><code>TURSO_DATABASE_URL</code>, <code>TURSO_AUTH_TOKEN</code></td><td>On Vercel</td><td>Where accounts live. Unset means a local file, which serverless hosts can’t keep.</td></tr>
          <tr><td><code>STALE_SECRET</code></td><td>In production</td><td>Encryption key for stored integration tokens.</td></tr>
          <tr><td><code>OPENAI_API_KEY</code></td><td>Recommended</td><td>Better claim extraction. Without it a rules engine runs.</td></tr>
          <tr><td><code>RAZORPAY_API_KEY</code>, <code>RAZORPAY_SECRET</code></td><td>For paid plans</td><td>Turns plans and limits on. Also accepted as <code>RAZORPAY_KEY_ID</code> / <code>RAZORPAY_KEY_SECRET</code>. Unset means unlimited.</td></tr>
          <tr><td><code>RAZORPAY_WEBHOOK_SECRET</code></td><td>For paid plans</td><td>Optional backup: verifies <code>order.paid</code> events sent to <code>/api/hooks/razorpay</code>.</td></tr>
          <tr><td><code>STALE_DB</code></td><td>No</td><td>Path of the local SQLite file (default <code>data/stale.db</code>).</td></tr>
          <tr><td><code>STALE_AUTH=off</code></td><td>Never in production</td><td>Dev and tests only. Trusts a tenant header instead of login.</td></tr>
        </tbody>
      </table></div>

      <h2 id="vercel">Deploy on Vercel</h2>
      <Steps>
        <li><b>Hosted FalkorDB</b>Create an instance on FalkorDB Cloud (or any server you control) and note its host, port, username and password.</li>
        <li><b>Hosted accounts DB</b>Create a database on Turso and note its URL and an auth token. Vercel’s filesystem is temporary, so this is what keeps logins alive.</li>
        <li><b>Import the repo</b>In Vercel choose <b>Add New → Project</b> and pick your fork.</li>
        <li><b>Add the variables</b>Paste the ones above, then deploy. Variables only apply to builds made after you add them.</li>
        <li><b>Check it</b>Open <code>/api/v1/health</code>. It should say FalkorDB is connected. Then try <code>/signup</code>.</li>
      </Steps>
      <Note>Webhook addresses and the MCP snippets in Settings are built from the address you’re visiting. Create integrations from your deployed URL, not localhost, so Slack and others can reach them.</Note>

      <h2 id="other-hosts">Railway, Render, Fly or a VPS</h2>
      <p>Any host that runs a Node server works: build with <code>npm run build</code>, start with <code>npm start</code>, and set the same variables. If the host has a persistent disk you can skip Turso and keep the SQLite file on it by setting <code>STALE_DB</code> to a path on that disk.</p>
    </>
  );
}
