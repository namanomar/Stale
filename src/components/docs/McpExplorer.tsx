"use client";

import { useMemo, useState } from "react";
import { CATEGORY_BLURB, MCP_TOOLS, type McpCategory } from "./mcpTools";
import { CopyBlock } from "@/components/ui";

const CATS = ["All", ...Object.keys(CATEGORY_BLURB)] as ("All" | McpCategory)[];

export function McpExplorer() {
  const [cat, setCat] = useState<"All" | McpCategory>("All");
  const [sel, setSel] = useState(MCP_TOOLS[1].name);
  const shown = useMemo(() => MCP_TOOLS.filter((t) => cat === "All" || t.category === cat), [cat]);
  const tool = MCP_TOOLS.find((t) => t.name === sel) ?? MCP_TOOLS[0];

  const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.name, arguments: tool.example } }, null, 2);

  return (
    <div>
      <div className="mcp-filter" role="tablist" aria-label="Filter tools by job">
        {CATS.map((c) => (
          <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)} role="tab" aria-selected={cat === c}>
            {c}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>{cat === "All" ? "13 tools, grouped by the job they do." : CATEGORY_BLURB[cat]}</p>

      <div className="mcp-grid">
        <div className="mcp-list">
          {shown.map((t) => (
            <button key={t.name} className={t.name === tool.name ? "on" : ""} onClick={() => setSel(t.name)}>
              <code>{t.name}</code>
              <small>{t.category}</small>
            </button>
          ))}
        </div>

        <div className="mcp-detail">
          <div className="cat">{tool.category}</div>
          <h3>{tool.name}</h3>
          <p>{tool.summary}</p>
          <p className="muted"><b>Use it when:</b> {tool.when}</p>

          <h4>Arguments</h4>
          {tool.args.length === 0 ? (
            <p className="muted small">None.</p>
          ) : (
            <table className="mcp-args">
              <tbody>
                {tool.args.map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}{a.required && <span className="req" title="required"> *</span>}</td>
                    <td><code>{a.type}</code> · {a.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4>Example call</h4>
          <CopyBlock text={call} />

          <h4>Returns</h4>
          <p>{tool.returns}</p>

          <div className="mcp-absent">
            <b>Not here on purpose: </b><code>approve_action</code>. Overriding the firewall is a human decision, available only through the REST API. An agent cannot approve its own blocked action.
          </div>
        </div>
      </div>
    </div>
  );
}
