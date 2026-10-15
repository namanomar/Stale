import { Card, Cards, Note, PageHead, Pill } from "@/components/docs/bits";

export const metadata = { title: "Core ideas · Stale docs" };

export default function Concepts() {
  return (
    <>
      <PageHead
        kicker="Start here"
        title="Core ideas"
        lead="Five words explain all of Stale: node, source, stale, taint and firewall. Learn these and every screen makes sense."
      />

      <h2 id="nodes">Nodes: four kinds of knowledge</h2>
      <p>Everything Stale remembers is a node, and every node has a <code>kind</code>.</p>
      <Cards>
        <Card title="Fact" tag="from a source">Something someone said or wrote. “Support SLA is 4 hours.” Always tied to a source and the exact quote.</Card>
        <Card title="Belief" tag="derived">A conclusion built from other nodes. “Premium customers get priority.” It depends on facts.</Card>
        <Card title="Decision" tag="derived">A choice that rests on beliefs and facts. “We will staff the night shift.”</Card>
        <Card title="Action" tag="does something">Something an agent or person intends to do. “Wire $48,000.” Actions are the only thing the firewall stops.</Card>
      </Cards>
      <p>Nodes link with <code>DEPENDS_ON</code> edges. A decision depends on the beliefs it uses, and a belief depends on the facts behind it. That chain is the whole point.</p>

      <h2 id="sources">Sources and trust</h2>
      <p>A <b>source</b> is where a fact came from: a Slack channel, an email thread, a repo, a page. Every source is either <Pill tone="good">trusted</Pill> or <Pill tone="bad">untrusted</Pill>.</p>
      <ul className="plain">
        <li>Your team, in your own channels, is trusted.</li>
        <li>Guests, shared channels, bots, strangers on public repos and unknown email senders are untrusted by default.</li>
        <li>You can quarantine or restore any source at any time, and everything downstream updates instantly.</li>
      </ul>

      <h2 id="stale">What “stale” means</h2>
      <p>A node is <Pill tone="warn">stale</Pill> when anything it depends on has changed. If a fact is replaced, Stale walks the <code>DEPENDS_ON</code> edges and marks everything above it, however deep.</p>
      <p>A node’s status is <Pill tone="good">valid</Pill>, <Pill tone="warn">stale</Pill> or <Pill>superseded</Pill> (replaced by a newer version, kept for history). Staleness is reachability, not a timer, so it only appears when something actually changed.</p>
      <Note kind="tip" title="Blast radius">Before you change anything, ask <code>impact</code> for a dry run. It lists what would go stale and which already-executed actions rested on the old fact.</Note>

      <h2 id="taint">Taint: a stranger’s words can’t act</h2>
      <p>A node is <Pill tone="bad">tainted</Pill> when any path of dependencies leads back to an untrusted source. Taint is computed live from the graph and never stored, so quarantining a source taints everything downstream immediately, and restoring it clears the taint.</p>

      <h2 id="firewall">The firewall</h2>
      <p>Every action goes through a check before it can run. An action is <b>blocked</b> if it is stale or tainted, and blocked actions cannot execute.</p>
      <ul className="plain">
        <li><code>check_action</code> returns <code>allowed</code> plus the exact path that caused a block.</li>
        <li>A human can <b>approve</b> a blocked action. The approval is tied to the action’s ancestry at that moment, so if a new problem appears upstream later, the approval is withdrawn.</li>
        <li>Agents cannot approve. There is no approve tool in MCP, on purpose.</li>
      </ul>

      <h2 id="repair">Repair: fixing stale knowledge in order</h2>
      <p><code>repair_plan</code> lists stale nodes in layers, root-first. Layer 0 must be rechecked first, because everything above it depends on it. <code>resolve</code> revalidates a node (optionally with corrected wording) and rebases it onto the newest version of its parents. It refuses while any parent is still stale.</p>

      <h2 id="review">The review queue</h2>
      <p>When Stale reads a message it decides: <b>confirm</b> (same as before), <b>add</b>, or <b>supersede</b> (contradicts something). Safe changes apply automatically when your workspace is set to <code>autoApply: trusted</code>. These wait for a human:</p>
      <div className="dx-table-wrap">
        <table className="dx-table"><tbody>
          <tr><td><code>untrusted-source</code></td><td>The claim came from a stranger.</td></tr>
          <tr><td><code>low-confidence</code></td><td>The extractor wasn’t sure what was said.</td></tr>
          <tr><td><code>possible-conflict</code></td><td>It might contradict a fact, but isn’t clearly the same subject.</td></tr>
          <tr><td><code>policy</code></td><td>The workspace is set to never auto-apply (<code>autoApply: never</code>).</td></tr>
        </tbody></table>
      </div>
    </>
  );
}
