"use client";

import Link from "next/link";
import { jf, makeApi, type EventRec, type IntegrationRec, type Me, type ReviewItem, type Snapshot } from "../api";
import { PageHead, short, timeAgo, useLoad } from "../ui";

const api = makeApi();

const EVENT_TEXT: Record<string, (e: EventRec) => string> = {
  node_added: (e) => `Remembered: ${short(String(e.payload.content), 90)}`,
  superseded: (e) => `A fact changed; ${e.payload.impacted} dependent item(s) flagged stale`,
  resolved: () => "A stale item was re-validated",
  source_quarantined: (e) => `Source ${e.node_id} was quarantined`,
  action_blocked: (e) => `Firewall blocked ${e.node_id}`,
  action_refused: (e) => `An attempt to run ${e.node_id} was refused`,
  action_executed: (e) => `Action ${e.node_id} was executed`,
  approval_revoked: (e) => `Approval of ${e.node_id} was revoked`,
  evidence_added: () => "Another message confirmed an existing fact",
  source_added: (e) => `New source: ${e.payload.name}`,
};

export default function Overview() {
  const graph = useLoad<Snapshot>(() => api.graph(), 6000);
  const events = useLoad<EventRec[]>(() => api.events(40), 6000);
  const integ = useLoad<IntegrationRec[]>(() => jf("GET", "/api/v1/integrations"), 15000);
  const reviews = useLoad<ReviewItem[]>(() => jf("GET", "/api/v1/review?status=pending"), 6000);
  const me = useLoad<Me>(() => jf("GET", "/api/auth/me"), 0);

  const s = graph.data?.stats;
  const nodes = graph.data?.nodes ?? [];
  const stale = nodes.filter((n) => n.status === "stale");
  const blocked = nodes.filter((n) => n.kind === "action" && n.gate === "blocked" && !n.executed_at && n.status !== "superseded");
  const atRisk = nodes.filter((n) => n.kind === "action" && n.status === "stale" && n.executed_at);
  const pending = reviews.data ?? [];
  const integrations = integ.data ?? [];
  const empty = graph.data && !nodes.length;
  const facts = nodes.filter((n) => n.kind === "fact" && n.status === "valid").length;

  const attention = [
    ...atRisk.map((n) => ({ tone: "red", text: `Already executed on outdated info: ${short(n.content, 70)}`, href: "/app/memory" })),
    ...blocked.map((n) => ({ tone: "red", text: `Blocked by the firewall: ${short(n.content, 70)}`, href: "/app/memory" })),
    ...pending.slice(0, 4).map((r) => ({ tone: "amber", text: `Needs review: ${short(r.payload.statement, 70)}`, href: "/app/review" })),
    ...stale.slice(0, 4).map((n) => ({ tone: "amber", text: `Stale: ${short(n.content, 70)}`, href: "/app/memory" })),
  ].slice(0, 8);

  return (
    <div className="page">
      <PageHead
        title={me.data ? `Good to see you, ${me.data.user?.name.split(" ")[0]}` : "Overview"}
        sub={me.data ? `${me.data.org.name} · what your company memory looks like right now` : undefined}
      />

      {empty && (
        <div className="box" style={{ marginBottom: 14, borderColor: "var(--bd-green)", background: "var(--tint-green)" }}>
          <h3 style={{ fontSize: 16 }}>Get started</h3>
          <ol className="steps">
            <li>
              <div>
                <b>Connect a source.</b> <span className="muted">Add Slack or a webhook so memory fills itself.</span>{" "}
                <Link href="/app/integrations" style={{ color: "var(--accent)" }}>Open integrations →</Link>
              </div>
            </li>
            <li>
              <div>
                <b>Try the pipeline.</b> <span className="muted">Paste a message in the playground and watch it become cited facts.</span>{" "}
                <Link href="/app/integrations#playground" style={{ color: "var(--accent)" }}>Open playground →</Link>
              </div>
            </li>
            <li>
              <div>
                <b>Give an agent access.</b> <span className="muted">Create an API key and connect any MCP-capable agent.</span>{" "}
                <Link href="/app/settings" style={{ color: "var(--accent)" }}>Open settings →</Link>
              </div>
            </li>
          </ol>
        </div>
      )}

      <div className="grid kpis" style={{ marginBottom: 14 }}>
        <Link href="/app/memory" className="box kpi link">
          <div className="label">Facts remembered</div>
          <div className="num">{facts}</div>
          <div className="hint">{s ? `${s.sources} source${s.sources === 1 ? "" : "s"}` : "…"}</div>
        </Link>
        <Link href="/app/memory" className={`box kpi link ${s?.stale ? "warn" : ""}`}>
          <div className="label">Stale items</div>
          <div className="num">{s?.stale ?? "–"}</div>
          <div className="hint">built on facts that changed</div>
        </Link>
        <Link href="/app/memory" className={`box kpi link ${blocked.length ? "bad" : ""}`}>
          <div className="label">Actions blocked</div>
          <div className="num">{s ? blocked.length : "–"}</div>
          <div className="hint">stopped by the firewall</div>
        </Link>
        <Link href="/app/review" className={`box kpi link ${pending.length ? "warn" : ""}`}>
          <div className="label">Awaiting review</div>
          <div className="num">{reviews.data ? pending.length : "–"}</div>
          <div className="hint">changes needing a human</div>
        </Link>
      </div>

      <div className="grid two">
        <div className="box">
          <h3>
            Needs attention <span className="sub">{attention.length ? `${attention.length} item(s)` : ""}</span>
          </h3>
          {attention.length === 0 ? (
            <div className="muted" style={{ padding: "18px 0" }}>
              ✓ Nothing needs attention. Memory is consistent.
            </div>
          ) : (
            attention.map((a, i) => (
              <Link key={i} href={a.href} className="row" style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <i className="dot" style={{ background: a.tone === "red" ? "var(--tainted)" : "var(--stale)" }} />
                <span className="grow">{a.text}</span>
                <span className="muted">→</span>
              </Link>
            ))
          )}
        </div>

        <div className="box">
          <h3>
            Connections <Link href="/app/integrations" className="sub" style={{ color: "var(--accent)" }}>Manage</Link>
          </h3>
          {integrations.length === 0 ? (
            <div className="muted" style={{ padding: "18px 0" }}>No sources connected yet.</div>
          ) : (
            integrations.map((i) => (
              <div key={i.id} className="row" style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                <i className="dot" style={{ background: i.status === "connected" ? "var(--valid)" : "var(--tainted)" }} />
                <span className="grow">
                  {i.name} <span className="muted small">· {i.type}</span>
                </span>
                <span className="muted small">
                  {i.events} event{i.events === 1 ? "" : "s"} · {timeAgo(i.last_event)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="box" style={{ marginTop: 14 }}>
        <h3>
          Recent activity <Link href="/app/activity" className="sub" style={{ color: "var(--accent)" }}>View all</Link>
        </h3>
        {(events.data ?? []).filter((e) => EVENT_TEXT[e.type]).slice(0, 8).map((e, i) => (
          <div key={e.id} className="row small" style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <span className="grow">{EVENT_TEXT[e.type](e)}</span>
            <span className="muted">{timeAgo(e.ts)}</span>
          </div>
        ))}
        {!(events.data ?? []).length && <div className="muted">No activity yet.</div>}
      </div>
    </div>
  );
}
