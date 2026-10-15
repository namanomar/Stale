import { Note, PageHead } from "@/components/docs/bits";
import { PricingTable } from "@/components/docs/PricingTable";

export const metadata = { title: "Pricing · Stale docs" };

export default function Pricing() {
  return (
    <>
      <PageHead
        kicker="Plans"
        title="Pricing"
        lead="Priced by the work Stale does for you, not by how many people look at it. Free to start, and you only pay when your team depends on it."
      />

      <Note kind="warn" title="Proposed pricing">These plans are a proposal for how Stale could be priced. Billing isn’t switched on yet, so nothing here is charged today.</Note>

      <PricingTable />

      <h2 id="meter">What “a message read” means</h2>
      <p>The one thing that costs real money is reading: sending a message, ticket, email or page through claim extraction. That is the unit Stale meters.</p>
      <ul className="plain">
        <li><b>Counted:</b> each new item that goes through extraction, however many claims come out of it.</li>
        <li><b>Free:</b> duplicates (an item Stale has already seen), reading the graph, asking <code>why</code> or <code>impact</code>, checking actions, and every MCP and REST call that doesn’t read new text.</li>
        <li><b>Agents are not seats.</b> API keys and MCP clients don’t count as people.</li>
      </ul>

      <h2 id="faq">Questions people ask</h2>
      <h3>What happens when we hit the limit?</h3>
      <p>New items are queued, not dropped, and nothing already in memory changes. The firewall keeps working, because it only reads the graph. You can upgrade, or wait for the next month.</p>
      <h3>Can we bring our own OpenAI key?</h3>
      <p>Yes. If you self-host, you supply your own key and there’s no message cap at all. The hosted plans include extraction.</p>
      <h3>Can we self-host for free?</h3>
      <p>Yes. The app is one Next.js project plus FalkorDB and a SQLite-compatible database. See <a className="in" href="/docs/self-host">Self-hosting</a>. Enterprise is for teams that want us to run it in their cloud and support it.</p>
      <h3>Why are connectors capped on Free?</h3>
      <p>Each connector is a steady stream of messages to read. Two is plenty to see whether Stale catches something real.</p>
      <h3>Is my data used to train anything?</h3>
      <p>Stale doesn’t train models on your data. Message text is sent to the extraction model only so it can be read, under that provider’s API data terms. Your graph is yours alone. See <a className="in" href="/docs/security">Security</a>.</p>
    </>
  );
}
