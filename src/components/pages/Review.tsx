"use client";

import { useEffect, useState } from "react";
import { ApiError, jf, makeApi, type ReviewItem } from "../api";
import { errText, PageHead, short, timeAgo, useLoad, useToast } from "../ui";

const api = makeApi();

const RISK: Record<string, { label: string; cls: string }> = {
  "untrusted-source": { label: "Untrusted source", cls: "red" },
  "low-confidence": { label: "Low confidence", cls: "amber" },
  "possible-conflict": { label: "Possible conflict", cls: "amber" },
  policy: { label: "Policy: needs approval", cls: "" },
};

function ReviewCard({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const toast = useToast();
  const p = item.payload;
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<number | null>(null);
  const risk = RISK[p.risk];

  useEffect(() => {
    if (item.status !== "pending" || !p.targetId) return;
    api.impact(p.targetId).then((r) => setImpact(r.count)).catch(() => setImpact(null));
  }, [item.status, p.targetId]);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      const r = await jf<{ impacted: number; actionsAtRisk: number }>("POST", `/api/v1/review/${item.id}`, { decision });
      toast(
        "ok",
        decision === "rejected"
          ? "Rejected. Memory is unchanged."
          : r.impacted
            ? `Applied. ${r.impacted} dependent item(s) are now flagged stale${r.actionsAtRisk ? `, including ${r.actionsAtRisk} action(s) already executed` : ""}.`
            : "Applied.",
      );
      onDone();
    } catch (e) {
      toast("err", errText(e));
      if (e instanceof ApiError && e.status === 409) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="box rv">
      <div className="row wrap">
        <span className={`badge-soft ${risk.cls}`}>{risk.label}</span>
        <span className="badge-soft gray">{p.op === "supersede" ? "Would change a fact" : "Would add a fact"}</span>
        <span className="muted small">
          from <b style={{ color: "var(--text)" }}>{p.sourceName}</b>
          {p.evidence.author ? ` · ${p.evidence.author}` : ""} · {timeAgo(item.created_at)}
        </span>
      </div>

      {p.op === "supersede" ? (
        <div className="diff">
          <div className="old">
            <small>Currently believed</small>
            <span>{p.targetContent}</span>
          </div>
          <div className="new">
            <small>Proposed</small>
            {p.statement}
          </div>
        </div>
      ) : (
        <div className="diff" style={{ gridTemplateColumns: "1fr" }}>
          <div className="new">
            <small>Proposed new fact</small>
            {p.statement}
          </div>
        </div>
      )}

      <div className="quote">“{short(p.evidence.quote, 280)}”</div>
      <div className="muted small">{p.reason}. Extraction confidence {(p.confidence * 100).toFixed(0)}%.</div>

      {item.status === "pending" ? (
        <div className="row">
          {impact !== null && p.op === "supersede" && (
            <span className={`small ${impact ? "" : "muted"}`} style={{ color: impact ? "var(--stale)" : undefined }}>
              {impact ? `Approving flags ${impact} dependent item(s) as stale.` : "Nothing depends on this fact yet."}
            </span>
          )}
          <span className="grow" />
          <button className="btn" disabled={busy} onClick={() => decide("rejected")}>
            Reject
          </button>
          <button className="btn primary" disabled={busy} onClick={() => decide("approved")}>
            Approve & apply
          </button>
        </div>
      ) : (
        <div className="small muted">
          {item.status === "approved" ? "Approved" : "Rejected"} by {item.decided_by} · {timeAgo(item.decided_at)}
        </div>
      )}
    </div>
  );
}

export default function Review() {
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const { data, reload, loading } = useLoad<ReviewItem[]>(() => jf("GET", "/api/v1/review"), 6000);
  const items = (data ?? []).filter((i) => (tab === "pending" ? i.status === "pending" : i.status !== "pending"));
  const pending = (data ?? []).filter((i) => i.status === "pending").length;

  return (
    <div className="page">
      <PageHead
        title="Review queue"
        sub="Changes the system wasn’t willing to make on its own: low confidence, a policy that requires approval, or an untrusted source trying to overwrite something your team already knows."
      />
      <div className="tabsbar">
        <button className={tab === "pending" ? "on" : ""} onClick={() => setTab("pending")}>
          Pending {pending > 0 && <span className="badge-soft amber">{pending}</span>}
        </button>
        <button className={tab === "decided" ? "on" : ""} onClick={() => setTab("decided")}>
          Decided
        </button>
      </div>
      <div className="grid" style={{ gap: 12 }}>
        {items.map((i) => (
          <ReviewCard key={i.id} item={i} onDone={reload} />
        ))}
        {!loading && items.length === 0 && (
          <div className="box muted" style={{ textAlign: "center", padding: 40 }}>
            {tab === "pending" ? "✓ Nothing waiting for review." : "No decisions yet."}
          </div>
        )}
      </div>
    </div>
  );
}
