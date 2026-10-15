import Link from "next/link";
import { Card, Cards, Note, PageHead, Steps } from "@/components/docs/bits";
import { CopyBlock } from "@/components/ui";

export default function Overview() {
  return (
    <>
      <PageHead
        kicker="Documentation"
        title="Know which facts have gone stale."
        lead="Stale is a memory for your company and your agents. It remembers every fact with its source, and when a fact changes it flags everything that was built on it."
      />

      <h2 id="problem">The problem in one picture</h2>
      <p>Someone says the renewal price is $9,000. A quote gets written, a forecast is built, an agent drafts a contract. Next week the price becomes $12,000. Nothing tells the quote, the forecast or the agent. Stale does.</p>
      <div className="dx-hero-demo" aria-label="Example of a fact changing">
        <div className="st-row"><b>Said in #sales</b><span>“Renewal price is $9,000 a year.”</span></div>
        <div className="st-row"><b>Built on it</b><span>Quote for Acme · Q3 forecast · Contract draft</span></div>
        <div className="st-row"><b>A week later</b><span>“Renewal price is now $12,000.”</span></div>
        <div className="st-row"><b>Stale says</b><span>3 things rested on the old price. Here they are, in the order to fix them.</span></div>
        <div className="st-row bad"><b>If a stranger said it</b><span>An email claims “the CFO approved this wire.” Stale remembers it, but no action built on it can run.</span></div>
      </div>

      <h2 id="tour">Five minute tour</h2>
      <Steps>
        <li><b>Create a workspace</b>Sign up at <Link className="in" href="/signup">/signup</Link>. You get one isolated memory graph that only your team can see.</li>
        <li><b>Connect where work happens</b>Slack, GitHub, Jira, Notion, email forwarding, or any webhook. See <Link className="in" href="/docs/connectors">Connectors</Link>.</li>
        <li><b>Let it read</b>Stale pulls the facts and decisions out of each message, keeps the exact quote, and compares with what it already believes. Repeats confirm. Contradictions replace and flag.</li>
        <li><b>Review the risky ones</b>Changes from strangers or low confidence ones wait in the review queue with old and new side by side.</li>
        <li><b>Plug in your agents</b>Create an API key in Settings and connect any MCP client. See <Link className="in" href="/docs/mcp">MCP tools</Link>.</li>
      </Steps>

      <h2 id="connect-agent">Connect an agent in one line</h2>
      <p>Create a key under <b>Settings → API keys</b>, then run:</p>
      <CopyBlock text={`claude mcp add --transport http stale https://YOUR-HOST/api/mcp \\\n  --header "Authorization: Bearer sk_YOUR_KEY"`} />
      <Note kind="tip">Sending a first fact is just as easy, with no agent: <code>POST /api/v1/ingest</code> with some text and a source name.</Note>

      <h2 id="map">Where to go next</h2>
      <Cards>
        <Link href="/docs/concepts" className="dx-card"><span className="tag">5 min</span><h3>Core ideas</h3><p>Facts, beliefs, staleness, taint. The whole model in one page.</p></Link>
        <Link href="/docs/architecture" className="dx-card"><span className="tag">Diagram</span><h3>Architecture</h3><p>Follow one message from Slack to a blocked wire transfer.</p></Link>
        <Link href="/docs/mcp" className="dx-card"><span className="tag">13 tools</span><h3>MCP tools</h3><p>Explore every tool your agent gets, with real payloads.</p></Link>
        <Link href="/docs/api" className="dx-card"><span className="tag">REST</span><h3>REST API</h3><p>Every endpoint, who can call it, what it returns.</p></Link>
        <Link href="/docs/security" className="dx-card"><span className="tag">Trust</span><h3>Security</h3><p>Roles, hashed keys, encrypted secrets, the firewall.</p></Link>
        <Link href="/docs/pricing" className="dx-card"><span className="tag">Plans</span><h3>Pricing</h3><p>Free to start. Pay when your team grows.</p></Link>
      </Cards>
      <Card title="Stuck?" tag="Help">Open <code>/api/v1/health</code>. It tells you whether the memory database is reachable.</Card>
    </>
  );
}
