import { Note, PageHead, Pill } from "@/components/docs/bits";

export const metadata = { title: "Connectors · Stale docs" };

const ROWS: { name: string; mode: "Push" | "Pull"; reads: string; trusted: string; untrusted: string; needs: string }[] = [
  { name: "Slack", mode: "Push", reads: "Messages in channels the bot is invited to, live", trusted: "Your workspace members", untrusted: "Slack Connect, outside guests, other apps’ bots", needs: "Signing secret + bot token" },
  { name: "Email", mode: "Push", reads: "Subject and plain-text body of forwarded mail", trusted: "Senders at the domains you list", untrusted: "Everyone else, including look-alike domains", needs: "A mail rule or inbound parse service" },
  { name: "Webhook", mode: "Push", reads: "Any JSON you POST", trusted: "Whatever you decide per call", untrusted: "Set untrusted: true", needs: "The integration secret" },
  { name: "GitHub", mode: "Pull", reads: "Issues, pull requests and their comments", trusted: "Owners, members, collaborators", untrusted: "Drive-by commenters on public repos", needs: "Fine-grained token, read access" },
  { name: "Jira", mode: "Pull", reads: "Issues and comments in chosen projects", trusted: "Your team", untrusted: "Service-desk customers", needs: "Atlassian Cloud site, email, API token" },
  { name: "Notion", mode: "Pull", reads: "Text of pages shared with the integration", trusted: "Pages in your workspace", untrusted: "–", needs: "Internal integration secret" },
];

export default function Connectors() {
  return (
    <>
      <PageHead
        kicker="Under the hood"
        title="Connectors"
        lead="Stale learns by reading where work already happens. Every connector reduces its raw events to the same thing, then trust is decided at the door."
      />

      <h2 id="two-kinds">Push and pull</h2>
      <p><Pill tone="good">Push</Pill> connectors wait: Slack events, forwarded email and webhooks arrive when something happens. <Pill>Pull</Pill> connectors fetch: you choose repos, projects or pages and press Sync, and anything already seen is skipped.</p>
      <Note>Push connectors can’t be tested by Stale calling out, so they show as <b>waiting</b> until the first message really arrives. Pull connectors are verified against the service with your credentials before they’re saved.</Note>

      <h2 id="matrix">At a glance</h2>
      <div className="dx-table-wrap"><table className="dx-table">
        <thead><tr><th>Connector</th><th>Mode</th><th>Reads</th><th>Trusted</th><th>Untrusted</th><th>You need</th></tr></thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.name}>
              <td><b>{r.name}</b></td>
              <td><Pill tone={r.mode === "Push" ? "good" : "neutral"}>{r.mode}</Pill></td>
              <td>{r.reads}</td><td>{r.trusted}</td><td>{r.untrusted}</td><td>{r.needs}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p>Each connector has a step-by-step guide on its page under <b>Integrations</b> inside the app.</p>

      <h2 id="webhook">Send anything: the generic webhook</h2>
      <p>If a tool can send a POST, it can teach Stale. Create a <b>Webhook</b> integration to get an address and a secret, then:</p>
      <div className="code">{`curl -X POST https://YOUR-HOST/api/hooks/generic/int_xxxx \\
  -H "x-stale-secret: YOUR_SECRET" \\
  -H "content-type: application/json" \\
  -d '{"source":"CRM","author":"Dana","text":"The renewal price is $9,000 per year."}'`}</div>

      <h2 id="ingest">Or call ingest directly</h2>
      <p>With an API key you can skip integrations entirely:</p>
      <div className="code">{`curl -X POST https://YOUR-HOST/api/v1/ingest \\
  -H "Authorization: Bearer sk_YOUR_KEY" \\
  -H "content-type: application/json" \\
  -d '{"kind":"manual","source":"Pricing sheet","text":"Support SLA is 4 hours for premium customers."}'`}</div>
      <div className="dx-table-wrap"><table className="dx-table">
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>text</code></td><td>Required. Up to 20,000 characters.</td></tr>
          <tr><td><code>source</code></td><td>Required. Where it was said. Messages with the same value share one Source.</td></tr>
          <tr><td><code>kind</code></td><td>slack · webhook · email · upload · manual · github · jira · notion · drive. Default <code>manual</code>.</td></tr>
          <tr><td><code>author</code></td><td>Who said it. Kept with the quote.</td></tr>
          <tr><td><code>untrusted</code></td><td>Set <code>true</code> if it came from outside the company.</td></tr>
          <tr><td><code>externalId</code></td><td>Your own dedupe key. Sending the same one twice is a no-op.</td></tr>
          <tr><td><code>url</code>, <code>ts</code></td><td>Link back to the original, and when it was said (ms since epoch).</td></tr>
        </tbody>
      </table></div>
      <p>The response says what happened to each claim: <code>added</code>, <code>confirmed</code>, <code>updated</code> (with how many things went stale) or <code>queued</code> for review.</p>

      <h2 id="secrets">What happens to your tokens</h2>
      <p>Connection secrets are encrypted at rest with AES-256-GCM using your workspace’s <code>STALE_SECRET</code>. Webhook secrets are compared in constant time. Slack requests must carry a valid signature or they’re rejected.</p>
    </>
  );
}
