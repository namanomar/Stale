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

      <Note kind="tip" title="Test mode">Payments run through Razorpay. While the keys are test keys, no real money moves: use Razorpay’s test cards and UPI ids.</Note>

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
      <p>New messages are refused with a clear “upgrade” error (HTTP 402) until you upgrade or the month rolls over. Nothing already in memory changes, and the firewall keeps working, because it only reads the graph.</p>
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
