"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GateVerdict, ImpactItem, NodeRec, SourceRec } from "@/lib/types";
import { ApiError, makeApi, type EventRec, type RepairPlan, type Snapshot } from "./api";
import GraphView from "./GraphView";
import Ledger from "./Ledger";
import { useToast } from "./ui";

type Tab = "inspect" | "repair" | "firewall" | "events";

const short = (s: string, n = 46) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function Pill({ kind, children }: { kind: string; children?: React.ReactNode }) {
  return <span className={`pill ${kind}`}>{children ?? kind}</span>;
}

function PathView({ path }: { path: { id: string; label: string }[] }) {
  return (
    <div className="path">
      {path.map((p, i) => (
        <span key={p.id} style={{ display: "contents" }}>
          {i > 0 && <span className="arrow">→</span>}
          <span className={`hop ${i === path.length - 1 ? "bad" : ""}`} title={p.label}>
            {short(p.label, 28)}
          </span>
        </span>
      ))}
    </div>
  );
}

function Verdict({ v }: { v: GateVerdict }) {
  if (v.allowed) return <div className="small" style={{ color: "var(--valid)" }}>✓ Firewall: safe to act on</div>;
  return (
    <div>
      <div className="small" style={{ color: "var(--tainted)", fontWeight: 600 }}>
        ✕ Blocked: {v.tainted && "tainted by an untrusted source"}
        {v.tainted && v.stale && " and "}
        {v.stale && "built on stale knowledge"}
      </div>
      {v.reasons.map((r, i) => (
        <div key={i}>
          <Pill kind={r.type === "tainted" ? "tainted" : "stale"} />
          <PathView path={r.path} />
        </div>
      ))}
    </div>
  );
}

const EVENT_TEXT: Record<string, (e: EventRec) => string> = {
  source_added: (e) => `Registered source ${e.payload.name}`,
  node_added: (e) => `Added ${e.payload.kind}: ${short(String(e.payload.content), 60)}`,
  superseded: (e) => `${e.node_id} changed → ${e.payload.impacted} dependents went stale (${e.payload.reason})`,
  resolved: (e) => `Re-validated ${e.node_id}`,
  source_quarantined: (e) => `Quarantined source ${e.node_id}${e.payload.reason ? ` (${e.payload.reason})` : ""}`,
  source_restored: (e) => `Restored trust in ${e.node_id}`,
  action_allowed: (e) => `Firewall allowed ${e.node_id}`,
  action_blocked: (e) => `Firewall BLOCKED ${e.node_id}`,
  action_refused: (e) => `Refused to execute ${e.node_id}`,
  action_executed: (e) => `Executed ${e.node_id}${e.payload.overridden ? " (human override)" : ""}`,
  action_approved: (e) => `${e.payload.approver} approved ${e.node_id}`,
  approval_revoked: (e) => `Approval of ${e.node_id} revoked: new problem appeared`,
};
const EVENT_COLOR: Record<string, string> = {
  superseded: "var(--stale)",
  action_blocked: "var(--tainted)",
  action_refused: "var(--tainted)",
  source_quarantined: "var(--tainted)",
  approval_revoked: "var(--tainted)",
  resolved: "var(--valid)",
  action_executed: "var(--accent)",
};

export default function Dashboard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("inspect");
  const [showOld, setShowOld] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [connectedOnly, setConnectedOnly] = useState(true);
  const [view, setView] = useState<"ledger" | "graph">("ledger");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState<string | null>(null);
  const [changed, setChanged] = useState<Map<string, number>>(new Map());
  const prev = useRef<Snapshot | null>(null);
  const api = useMemo(() => makeApi(), []);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const [s, p, e] = await Promise.all([api.graph(), api.plan(), api.events()]);
      // Which nodes changed since last time? They get a staggered flash so the cascade is visible.
      const before = prev.current;
      if (before && before.tenant === s.tenant) {
        const old = new Map(before.nodes.map((n) => [n.id, n]));
        const wasTainted = new Set(before.tainted);
        const now = new Map<string, number>();
        s.nodes.forEach((n, i) => {
          const o = old.get(n.id);
          const isNew = !o;
          const flipped = o && (o.status !== n.status || o.gate !== n.gate || o.executed_at !== n.executed_at);
          const newlyTainted = s.tainted.includes(n.id) && !wasTainted.has(n.id);
          if (isNew || flipped || newlyTainted) now.set(n.id, (n.stale_depth ?? 0) * 160 + (i % 5) * 30);
        });
        if (now.size) {
          setChanged(now);
          setTimeout(() => setChanged(new Map()), 2200);
        }
      }
      prev.current = s;
      setSnap(s);
      setPlan(p);
      setEvents(e);
      setOffline(null);
    } catch (err) {
      setOffline(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    prev.current = null;
    setSelected(null);
    refresh();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  /** Run a mutation, then refresh. API errors become toasts with the reason. */
  const act = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: (r: T) => string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast("ok", ok(r));
        await refresh();
        return r;
      } catch (e) {
        if (e instanceof ApiError) {
          const v = e.details as GateVerdict | undefined;
          const blockers = (e.details as any)?.blockers as { id: string; reason?: string; status?: string }[] | undefined;
          toast(
            "err",
            e.message,
            v?.reasons ? (
              <Verdict v={v} />
            ) : blockers ? (
              <div className="small">{blockers.map((b) => `${b.id}: ${b.reason ?? b.status}`).join(" · ")}</div>
            ) : undefined,
          );
        } else toast("err", String(e));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  const node = snap?.nodes.find((n) => n.id === selected) ?? null;
  const source = snap?.sources.find((s) => s.id === selected) ?? null;
  const isTainted = (id: string) => !!snap?.tainted.includes(id);
  const actions = snap?.nodes.filter((n) => n.kind === "action" && n.status !== "superseded") ?? [];
  const blockedCount = actions.filter((a) => !a.executed_at && a.gate === "blocked").length;
  const hasDemo = !!snap?.nodes.some((n) => n.id === "f_price");

  return (
    <div className="explorer">
      <header className="bar">
        <h1>Memory</h1>
        <button
          className="btn"
          disabled={busy}
          onClick={() => act(() => api.seed(), () => "Loaded sample data: a product launch and a poisoned invoice email")}
          title="Replaces this workspace's memory with a sample scenario"
        >
          Load sample data
        </button>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "ledger"} className={view === "ledger" ? "on" : ""} onClick={() => setView("ledger")}>List</button>
          <button role="tab" aria-selected={view === "graph"} className={view === "graph" ? "on" : ""} onClick={() => setView("graph")}>Graph</button>
        </div>
        <label className="small muted row">
          <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> old versions
        </label>
        {view === "graph" && (
          <>
            <label className="small muted row"><input type="checkbox" checked={connectedOnly} onChange={(e) => setConnectedOnly(e.target.checked)} /> only connected</label>
            <label className="small muted row"><input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} /> source boxes</label>
          </>
        )}
        {snap && (
          <div className="stats">
            <span className="chip"><i className="dot" style={{ background: "var(--valid)" }} /><b>{snap.stats.valid}</b> valid</span>
            <span className="chip"><i className="dot" style={{ background: "var(--stale)" }} /><b>{snap.stats.stale}</b> stale</span>
            <span className="chip"><i className="dot" style={{ background: "var(--tainted)" }} /><b>{snap.stats.tainted}</b> tainted</span>
            <span className="chip"><b>{blockedCount}</b> blocked actions</span>
          </div>
        )}
      </header>

      <div className="main">
        <div className="canvas">
          {offline ? (
            <div className="empty" style={{ paddingTop: 120 }}>
              <h3 style={{ color: "var(--tainted)" }}>Can’t reach the backend</h3>
              <div>{offline}</div>
              <p className="small">Start FalkorDB (<code>docker compose up -d</code>) and reload.</p>
            </div>
          ) : snap && (snap.nodes.length || snap.sources.length) ? (
            view === "ledger" ? (
              <Ledger snap={snap} selected={selected} onSelect={setSelected} showOld={showOld} />
            ) : (
            <>
              <GraphView snap={snap} selected={selected} onSelect={setSelected} showOld={showOld} changed={changed} showSources={showSources} connectedOnly={connectedOnly} />
              <div className="legend">
                <span><i className="dot" style={{ background: "var(--valid)" }} /> valid</span>
                <span><i className="dot" style={{ background: "var(--stale)" }} /> stale (an upstream fact changed)</span>
                <span><i className="dot" style={{ background: "var(--tainted)" }} /> tainted (reachable from an untrusted source)</span>
                <span><i className="dot" style={{ background: "var(--accent)" }} /> selected · why it’s believed</span>
              </div>
            </>
            )
          ) : (
            <div className="empty" style={{ paddingTop: 140 }}>
              <h2>Nothing in memory yet</h2>
              <p>Connect a source and messages will appear here as cited facts. Or load a sample scenario to explore.</p>
              <p><a className="btn primary" href="/app/integrations">Connect a source</a></p>
            </div>
          )}
        </div>

        <aside className="side">
          <div className="tabs">
            {(
              [
                ["inspect", "Inspect"],
                ["repair", "Repair"],
                ["firewall", "Firewall"],
                ["events", "Activity"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
                {label}
                {k === "repair" && !!plan?.total && <span className="badge" style={{ background: "var(--stale)", color: "#111" }}>{plan.total}</span>}
                {k === "firewall" && blockedCount > 0 && <span className="badge">{blockedCount}</span>}
              </button>
            ))}
          </div>

          {tab === "inspect" && (
            <Inspector
              snap={snap}
              node={node}
              source={source}
              tainted={node ? isTainted(node.id) : false}
              api={api}
              act={act}
              busy={busy}
              hasDemo={hasDemo}
              select={setSelected}
            />
          )}
          {tab === "repair" && <Repair plan={plan} act={act} api={api} busy={busy} select={(id) => { setSelected(id); setTab("inspect"); }} />}
          {tab === "firewall" && (
            <Firewall snap={snap} actions={actions} api={api} act={act} busy={busy} select={(id) => { setSelected(id); setTab("inspect"); }} />
          )}
          {tab === "events" && <Events events={events} />}
        </aside>
      </div>

    </div>
  );
}

type Act = <T>(fn: () => Promise<T>, ok?: (r: T) => string) => Promise<T | undefined>;
type Api = ReturnType<typeof makeApi>;

/* ------------------------------------------------------------------ */

function Inspector(props: {
  snap: Snapshot | null;
  node: NodeRec | null;
  source: SourceRec | null;
  tainted: boolean;
  api: Api;
  act: Act;
  busy: boolean;
  hasDemo: boolean;
  select: (id: string | null) => void;
}) {
  const { snap, node, source, tainted, api, act, busy, hasDemo, select } = props;
  const [impact, setImpact] = useState<ImpactItem[] | null>(null);
  const [verdict, setVerdict] = useState<GateVerdict | null>(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const stamp = snap?.nodes.map((n) => n.status + n.gate + n.executed_at).join() + (snap?.tainted.join() ?? "");

  useEffect(() => {
    setText("");
    setReason("");
  }, [node?.id]);

  useEffect(() => {
    setImpact(null);
    setVerdict(null);
    if (!node) return;
    let live = true;
    api.impact(node.id).then((r) => live && setImpact(r.impacted)).catch(() => {});
    api.check(node.id).then((v) => live && setVerdict(v)).catch(() => {});
    return () => {
      live = false;
    };
  }, [node?.id, stamp, api]); // eslint-disable-line react-hooks/exhaustive-deps

  if (source) {
    return (
      <div className="pane">
        <div className="card">
          <h4>Source · {source.type}</h4>
          <div style={{ fontWeight: 600 }}>{source.name}</div>
          <div className="row" style={{ margin: "8px 0" }}>
            <Pill kind={source.trust === "trusted" ? "valid" : "tainted"}>{source.trust}</Pill>
            <span className="small muted mono">{source.id}</span>
          </div>
          {source.trust_reason && <div className="small muted">Reason: {source.trust_reason}</div>}
        </div>
        <button
          className={`btn ${source.trust === "trusted" ? "danger" : ""}`}
          disabled={busy}
          onClick={() =>
            act(
              () => api.trust(source.id, source.trust === "trusted" ? "untrusted" : "trusted", source.trust === "trusted" ? "marked untrusted in UI" : undefined),
              (r) =>
                source.trust === "trusted"
                  ? `Quarantined: ${r.affected.length} nodes tainted${r.executedActions.length ? `, ${r.executedActions.length} already-executed action(s) at risk` : ""}`
                  : "Trust restored",
            )
          }
        >
          {source.trust === "trusted" ? "Quarantine this source" : "Restore trust"}
        </button>
        <p className="small muted">Quarantining taints everything derived from this source, blocks pending actions that depend on it, and reports ones that already ran.</p>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="pane">
        <div className="card">
          <h4>How to read this</h4>
          <p className="small" style={{ margin: 0 }}>
            Every belief, decision and action is linked to the facts it relied on, and every fact to where it came from.
            Click any node to see <b style={{ color: "var(--accent)" }}>why it’s believed</b> (blue) and{" "}
            <b style={{ color: "var(--impact)" }}>what depends on it</b> (amber).
          </p>
        </div>
        {hasDemo && snap && (
          <div className="card">
            <h4>Try the demo story</h4>
            <div className="small muted" style={{ marginBottom: 8 }}>
              1) The vendor raises the price, so the budget, the vendor decision, marketing and a PO that was already sent all go stale.
            </div>
            <button
              className="btn warn"
              disabled={busy || snap.nodes.find((n) => n.id === "f_price")?.status !== "valid"}
              onClick={() => {
                select("f_price");
                act(
                  () => api.supersede("f_price", "Acme now quotes $140/unit for 1,000 units", "vendor raised price 40%"),
                  (r) => `Price changed: ${r.impacted.length} nodes stale${r.executedActionsAtRisk.length ? ", incl. a PO already sent!" : ""}`,
                );
              }}
            >
              ▶ Vendor raises the price
            </button>
            <div className="small muted" style={{ margin: "12px 0 8px" }}>
              2) An unknown sender’s email tries to get the agent to wire money. The firewall traced it to the untrusted source and blocked it. Open the Firewall tab.
            </div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              3) Or discover that a trusted source was compromised:
            </div>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => {
                select("s_vendor");
                act(() => api.trust("s_vendor", "untrusted", "vendor account compromised"), (r) => `Quarantined: ${r.affected.length} nodes tainted`);
              }}
            >
              ▶ Quarantine the vendor quote
            </button>
          </div>
        )}
      </div>
    );
  }

  const n = node;
  const canChange = n.status === "valid";
  return (
    <div className="pane">
      <div className="card">
        <div className="row wrap" style={{ marginBottom: 6 }}>
          <Pill kind={n.status} />
          {tainted && <Pill kind="tainted" />}
          {n.kind === "action" && !n.executed_at && n.gate && <Pill kind={n.gate} />}
          {n.executed_at && <Pill kind="executed" />}
          <span className="muted small" style={{ textTransform: "capitalize" }}>{n.kind}</span>
          <span className="muted small mono" style={{ marginLeft: "auto" }}>{n.id}</span>
        </div>
        <div style={{ fontSize: 15 }}>{n.content}</div>
        {n.status === "stale" && (
          <div className="small" style={{ marginTop: 8, color: "var(--stale)" }}>
            Stale: <b>{n.stale_reason}</b> — root cause{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); select(n.stale_root!); }} className="mono" style={{ color: "var(--accent)" }}>{n.stale_root}</a>, {n.stale_depth} hop(s) upstream.
          </div>
        )}
        {n.status === "superseded" && <div className="small muted" style={{ marginTop: 8 }}>Replaced by a newer version: {n.stale_reason}</div>}
        {n.approved_by && <div className="small" style={{ marginTop: 8, color: "var(--valid)" }}>Approved by {n.approved_by}{n.approval_note ? `: “${n.approval_note}”` : ""}</div>}
      </div>

      {verdict && (
        <div className="card">
          <h4>Firewall verdict</h4>
          <Verdict v={verdict} />
        </div>
      )}

      <div className="card">
        <h4>Blast radius {impact && `· ${impact.length}`}</h4>
        {!impact ? (
          <div className="small muted">…</div>
        ) : impact.length === 0 ? (
          <div className="small muted">Nothing depends on this.</div>
        ) : (
          <div style={{ maxHeight: 190, overflow: "auto" }}>
            {impact.map((i) => (
              <div key={i.id} className="row small" style={{ padding: "3px 0", cursor: "pointer" }} onClick={() => select(i.id)}>
                <span className="muted mono" style={{ width: 18 }}>{i.depth}</span>
                <span className="grow">{short(i.content, 44)}</span>
                {i.executed && <Pill kind="executed">sent</Pill>}
                <Pill kind={i.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {canChange && n.kind !== "action" && (
        <div className="card">
          <h4>This changed in the real world</h4>
          <textarea className="textarea" placeholder="New value, e.g. “Acme now quotes $140/unit”" value={text} onChange={(e) => setText(e.target.value)} />
          <input className="input" style={{ marginTop: 6 }} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className="btn warn"
            style={{ marginTop: 8 }}
            disabled={busy || !text.trim()}
            onClick={() =>
              act(
                () => api.supersede(n.id, text.trim(), reason.trim() || undefined),
                (r) => `${r.impacted.length} dependent(s) went stale${r.executedActionsAtRisk.length ? `, ${r.executedActionsAtRisk.length} already executed!` : ""}`,
              ).then(() => setText(""))
            }
          >
            Update & cascade
          </button>
        </div>
      )}

      {n.status === "stale" && (
        <div className="card">
          <h4>Re-validate</h4>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Check it against the new facts. Fix upstream nodes first; this fails while a parent is still stale.
          </div>
          <textarea className="textarea" placeholder="Corrected text (optional, leave blank to confirm it still holds)" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="btn primary"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => act(() => api.resolve(n.id, text.trim() || undefined), () => "Re-validated").then(() => setText(""))}
          >
            Re-validate
          </button>
        </div>
      )}

      {n.kind === "action" && n.status !== "superseded" && !n.executed_at && (
        <div className="card">
          <h4>Act</h4>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.execute(n.id), () => "Executed")}>
              Execute
            </button>
          </div>
          {n.gate !== "allowed" && (
            <div style={{ marginTop: 10 }}>
              <div className="small muted">Humans can override the firewall. Overrides are recorded and revoked if a new problem shows up.</div>
              <div className="row" style={{ marginTop: 6 }}>
                <input className="input" placeholder="Your name" value={approver} onChange={(e) => setApprover(e.target.value)} />
                <button className="btn danger" disabled={busy || !approver.trim()} onClick={() => act(() => api.approve(n.id, approver.trim(), "approved in UI"), () => "Approved; you can execute it now")}>
                  Approve
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Repair({ plan, act, api, busy, select }: { plan: RepairPlan | null; act: Act; api: Api; busy: boolean; select: (id: string) => void }) {
  if (!plan || plan.total === 0) {
    return (
      <div className="pane">
        <div className="empty">
          <div style={{ fontSize: 28 }}>✓</div>
          Nothing is stale. Change a fact to see the repair plan.
        </div>
      </div>
    );
  }
  const repairAll = async () => {
    // Root-first: layers are already ordered; stop at the first failure.
    for (const layer of plan.layers) {
      for (const n of layer.nodes) {
        const r = await act(() => api.resolve(n.id));
        if (!r) return;
      }
    }
  };
  return (
    <div className="pane">
      <div className="card">
        <h4>{plan.total} stale · fix top to bottom</h4>
        <div className="small muted">A node can only be re-validated once everything it relies on is fixed. Each layer unlocks the next.</div>
        {plan.executedActionsAtRisk > 0 && (
          <div className="small" style={{ color: "var(--tainted)", marginTop: 6 }}>
            ⚠ {plan.executedActionsAtRisk} action(s) were already executed on the old facts.
          </div>
        )}
        <button className="btn sm" style={{ marginTop: 8 }} disabled={busy} onClick={repairAll} title="Confirms every node unchanged, root first. Use per-node edits to fix content.">
          Confirm all, root-first
        </button>
      </div>
      {plan.layers.map((l) => (
        <div key={l.layer}>
          <div className="layer-label">Step {l.layer + 1}{l.layer === 0 ? " · start here" : ""}</div>
          {l.nodes.map((n) => (
            <div key={n.id} className="card" style={{ marginBottom: 6 }}>
              <div className="row">
                <div className="grow small" style={{ cursor: "pointer" }} onClick={() => select(n.id)}>
                  <span className="muted" style={{ textTransform: "capitalize" }}>{n.kind}: </span>
                  {short(n.content, 70)}
                  {n.executed_at && <> <Pill kind="executed">already sent</Pill></>}
                </div>
                <button className="btn sm" disabled={busy || l.layer > 0 && false} onClick={() => act(() => api.resolve(n.id), () => "Re-validated")}>
                  Confirm
                </button>
              </div>
              {n.rebase.map((r) => (
                <div key={r.from} className="small muted" style={{ marginTop: 4 }}>
                  now relies on “{short(r.toContent ?? "?", 40)}” instead of “{short(r.fromContent, 40)}”
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Firewall({ snap, actions, api, act, busy, select }: { snap: Snapshot | null; actions: NodeRec[]; api: Api; act: Act; busy: boolean; select: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<GateVerdict | null>(null);
  useEffect(() => {
    setVerdict(null);
    if (open) api.check(open).then(setVerdict).catch(() => {});
  }, [open, api, snap?.tainted.length, snap?.stats.stale]);
  if (!snap) return <div className="pane" />;
  return (
    <div className="pane">
      <div className="card">
        <h4>Sources</h4>
        {snap.sources.length === 0 && <div className="small muted">None</div>}
        {snap.sources.map((s) => (
          <div key={s.id} className="list-item">
            <div className="grow">
              <div className="small" style={{ cursor: "pointer" }} onClick={() => select(s.id)}>{s.name}</div>
              <div className="small muted">{s.type}</div>
            </div>
            <Pill kind={s.trust === "trusted" ? "valid" : "tainted"}>{s.trust}</Pill>
            <button className="btn sm" disabled={busy} onClick={() => act(() => api.trust(s.id, s.trust === "trusted" ? "untrusted" : "trusted", "toggled in UI"), (r) => `${r.affected.length} node(s) affected`)}>
              {s.trust === "trusted" ? "Quarantine" : "Restore"}
            </button>
          </div>
        ))}
      </div>
      <div className="card">
        <h4>Actions</h4>
        {actions.length === 0 && <div className="small muted">None</div>}
        {actions.map((a) => {
          const state = a.executed_at ? "executed" : a.gate ?? "allowed";
          return (
            <div key={a.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div className="row">
                <div className="grow small">{short(a.content, 60)}</div>
                <Pill kind={state} />
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn sm" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Hide" : "Why?"}</button>
                <button className="btn sm" onClick={() => select(a.id)}>Inspect</button>
                {!a.executed_at && (
                  <button className="btn sm primary" disabled={busy} onClick={() => act(() => api.execute(a.id), () => "Executed")}>
                    Run
                  </button>
                )}
              </div>
              {open === a.id && verdict && <div style={{ marginTop: 6 }}><Verdict v={verdict} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Events({ events }: { events: EventRec[] }) {
  if (!events.length) return <div className="pane"><div className="empty">No activity yet.</div></div>;
  return (
    <div className="pane">
      {events.map((e) => (
        <div key={e.id} className="list-item">
          <i className="dot" style={{ marginTop: 6, background: EVENT_COLOR[e.type] ?? "var(--muted)" }} />
          <div className="grow small">
            {(EVENT_TEXT[e.type] ?? (() => e.type))(e)}
            <div className="muted" style={{ fontSize: 11 }}>{new Date(e.ts).toLocaleTimeString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
