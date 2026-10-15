import { Note, PageHead, Steps } from "@/components/docs/bits";
import { McpExplorer } from "@/components/docs/McpExplorer";
import { CopyBlock } from "@/components/ui";

export const metadata = { title: "MCP tools · Stale docs" };

const CONFIG = JSON.stringify({ mcpServers: { stale: { type: "http", url: "https://YOUR-HOST/api/mcp", headers: { Authorization: "Bearer sk_YOUR_KEY" } } } }, null, 2);

export default function Mcp() {
  return (
    <>
      <PageHead
        kicker="Build with Stale"
        title="MCP tools"
        lead="Give any agent a memory that can say “I’m not sure that’s still true.” Thirteen tools, one endpoint, and no way for the agent to approve its own mistakes."
      />

      <h2 id="endpoint">The endpoint</h2>
      <div className="dx-table-wrap"><table className="dx-table"><tbody>
        <tr><td>URL</td><td><code>https://YOUR-HOST/api/mcp</code></td></tr>
        <tr><td>Transport</td><td>Streamable HTTP, stateless (a fresh server for every request, JSON responses)</td></tr>
        <tr><td>Methods</td><td><code>POST</code> for calls. <code>GET</code> and <code>DELETE</code> are also routed to the same handler.</td></tr>
        <tr><td>Auth</td><td><code>Authorization: Bearer sk_…</code> (an API key)</td></tr>
        <tr><td>Role needed</td><td><b>member</b> or higher. The key decides which workspace the agent can see.</td></tr>
        <tr><td>Server name</td><td><code>stale-memory</code></td></tr>
      </tbody></table></div>

      <h2 id="connect">Connect a client</h2>
      <Steps>
        <li><b>Make a key</b>In the app, open <b>Settings → API keys</b> and create one. It is shown once; Stale only keeps a hash.</li>
        <li><b>Add the server</b>Pick your client below.</li>
        <li><b>Ask something</b>“What is stale in memory right now?” should call <code>memory_overview</code>.</li>
      </Steps>
      <CopyBlock label="Claude Code" text={`claude mcp add --transport http stale https://YOUR-HOST/api/mcp \\\n  --header "Authorization: Bearer sk_YOUR_KEY"`} />
      <div style={{ height: 12 }} />
      <CopyBlock label="Any client that reads an mcpServers config" text={CONFIG} />

      <h2 id="loop">The loop your agent should follow</h2>
      <p>The server ships these instructions to the agent automatically. In human words:</p>
      <ol>
        <li><b>Register</b> sources, and mark untrusted ones honestly.</li>
        <li><b>Remember</b> facts with a source, and derive beliefs and decisions from the nodes they rely on.</li>
        <li><b>Propose</b> every action with <code>propose_action</code> before doing it.</li>
        <li><b>Check</b> with <code>check_action</code> right before acting. Never act on a blocked action.</li>
        <li><b>Update</b> with <code>update_fact</code> when the world changes, then <b>repair</b> with <code>repair_plan</code> and <code>resolve</code>, root-first.</li>
      </ol>

      <h2 id="tools">Explore every tool</h2>
      <p>Pick a tool to see its arguments, when to call it, and a ready-to-send payload.</p>
      <McpExplorer />

      <h2 id="errors">When something goes wrong</h2>
      <p>Errors come back as an MCP tool result with <code>isError: true</code> and a JSON body the agent can read:</p>
      <div className="code">{`{
  "error": "Cannot build on stale or superseded nodes",
  "details": { "blockers": [ ... ] }
}`}</div>
      <p>Typical causes: a dependency is stale or superseded (repair it first), a node id doesn’t exist, the id is already taken, or the action is blocked by the firewall (403).</p>
      <Note kind="warn" title="Treat blocked as final">If <code>check_action</code> says blocked, don’t retry with different wording. The block is about where the action’s inputs came from, not how it was phrased. Send it to a human for approval.</Note>
    </>
  );
}
