"use client";

import { jf, makeApi, type EventRec } from "../api";
import { PageHead, short, timeAgo, useLoad } from "../ui";

const api = makeApi();

const TEXT: Record<string, (e: EventRec) => string> = {
  source_added: (e) => `Source registered: ${e.payload.name}`,
  node_added: (e) => `Remembered ${e.payload.kind}: ${short(String(e.payload.content), 100)}`,
  superseded: (e) => `${e.node_id} changed (${e.payload.reason}); ${e.payload.impacted} dependent item(s) flagged stale`,
  resolved: (e) => `${e.node_id} re-validated`,
  evidence_added: (e) => `${e.node_id} confirmed by another message`,
  source_quarantined: (e) => `Source ${e.node_id} quarantined${e.payload.reason ? `: ${e.payload.reason}` : ""}`,
  source_restored: (e) => `Source ${e.node_id} trusted again`,
  action_allowed: (e) => `Firewall allowed ${e.node_id}`,
  action_blocked: (e) => `Firewall blocked ${e.node_id}`,
  action_refused: (e) => `Execution of ${e.node_id} refused`,
  action_executed: (e) => `${e.node_id} executed${e.payload.overridden ? " with a human override" : ""}`,
  action_approved: (e) => `${e.payload.approver} approved ${e.node_id}`,
  approval_revoked: (e) => `Approval of ${e.node_id} revoked because a new problem appeared`,
};
const COLOR: Record<string, string> = {
  superseded: "var(--stale)",
  action_blocked: "var(--tainted)",
  action_refused: "var(--tainted)",
  source_quarantined: "var(--tainted)",
  approval_revoked: "var(--tainted)",
  resolved: "var(--valid)",
  action_executed: "var(--accent)",
  evidence_added: "var(--valid)",
};

interface Ledger {
  kind: string;
  external_id: string;
  status: string;
  summary: string | null;
  created_at: number;
}

export default function Activity() {
  const events = useLoad<EventRec[]>(() => api.events(150), 5000);
  const ledger = useLoad<Ledger[]>(() => jf("GET", "/api/v1/ingest"), 5000);
  return (
    <div className="page">
      <PageHead title="Activity" sub="An audit trail of everything that changed memory, and everything that was read into it." />
      <div className="grid two" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
        <div className="box">
          <h3>Memory changes</h3>
          {(events.data ?? []).map((e, i) => (
            <div key={e.id} className="row small" style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none", alignItems: "flex-start" }}>
              <i className="dot" style={{ marginTop: 6, background: COLOR[e.type] ?? "var(--muted)", flex: "none" }} />
              <span className="grow">{(TEXT[e.type] ?? (() => e.type))(e)}</span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(e.ts)}</span>
            </div>
          ))}
          {events.data?.length === 0 && <div className="muted">Nothing yet.</div>}
        </div>
        <div className="box">
          <h3>Ingested</h3>
          {(ledger.data ?? []).map((l, i) => (
            <div key={`${l.kind}${l.external_id}`} className="small" style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <div className="row">
                <span className="badge-soft">{l.kind}</span>
                <span className="grow muted mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.external_id}</span>
                <span className="muted">{timeAgo(l.created_at)}</span>
              </div>
              <div className="muted" style={{ marginTop: 3 }}>{l.summary}</div>
            </div>
          ))}
          {ledger.data?.length === 0 && <div className="muted">No messages read yet.</div>}
        </div>
      </div>
    </div>
  );
}
