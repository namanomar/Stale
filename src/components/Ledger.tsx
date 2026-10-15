"use client";

import { useMemo, useState } from "react";
import type { NodeRec } from "@/lib/types";
import type { Snapshot } from "./api";

interface Evidence {
  quote?: string;
  author?: string;
  ts?: number;
  source?: string;
}

const KIND_LABEL: Record<string, string> = { fact: "Fact", belief: "Belief", decision: "Decision", action: "Action" };
const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

type Filter = "all" | "attention" | "fact" | "plan";

/**
 * The readable face of the graph: one card per piece of memory, newest first, with the words that
 * justified it, who said them and where. Click a card to open it in the inspector.
 */
export default function Ledger({
  snap,
  selected,
  onSelect,
  showOld,
}: {
  snap: Snapshot;
  selected: string | null;
  onSelect: (id: string) => void;
  showOld: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const info = useMemo(() => {
    const sourceOf = new Map<string, string>();
    const parents = new Map<string, number>();
    const replaces = new Map<string, string>();
    const srcById = new Map(snap.sources.map((s) => [s.id, s]));
    for (const e of snap.edges) {
      if (e.type === "FROM") sourceOf.set(e.from, e.to);
      else if (e.type === "DEPENDS_ON") parents.set(e.from, (parents.get(e.from) ?? 0) + 1);
      else if (e.type === "SUPERSEDES") replaces.set(e.from, e.to);
    }
    return { sourceOf, parents, replaces, srcById, byId: new Map(snap.nodes.map((n) => [n.id, n])) };
  }, [snap]);

  const tainted = useMemo(() => new Set(snap.tainted), [snap.tainted]);
  const needs = (n: NodeRec) =>
    n.status === "stale" || tainted.has(n.id) || (n.kind === "action" && n.gate === "blocked" && !n.executed_at);

  const rows = snap.nodes
    .filter((n) => showOld || n.status !== "superseded")
    .filter((n) =>
      filter === "all" ? true : filter === "attention" ? needs(n) && n.status !== "superseded" : filter === "fact" ? n.kind === "fact" : n.kind !== "fact",
    )
    .filter((n) => !q.trim() || n.content.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.created_at - a.created_at);

  const counts = {
    all: snap.nodes.filter((n) => showOld || n.status !== "superseded").length,
    attention: snap.nodes.filter((n) => n.status !== "superseded" && needs(n)).length,
    fact: snap.nodes.filter((n) => n.kind === "fact" && (showOld || n.status !== "superseded")).length,
    plan: snap.nodes.filter((n) => n.kind !== "fact" && (showOld || n.status !== "superseded")).length,
  };

  return (
    <div className="ledger">
      <div className="ledger-tools">
        <div className="seg" role="tablist" aria-label="Filter memory">
          {(
            [
              ["all", "Everything"],
              ["attention", "Needs attention"],
              ["fact", "Facts"],
              ["plan", "Plans & actions"],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {label} <span>{counts[k]}</span>
            </button>
          ))}
        </div>
        <input className="input" placeholder="Search memory…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search memory" />
      </div>

      <div className="ledger-list">
        {rows.length === 0 && <div className="empty">Nothing matches.</div>}
        {rows.map((n) => {
          const src = info.srcById.get(info.sourceOf.get(n.id) ?? "");
          const ev = ((n.meta?.evidence as Evidence[] | undefined) ?? [])[0];
          const isT = tainted.has(n.id);
          const old = info.replaces.get(n.id);
          const status = n.status === "superseded" ? "superseded" : n.status === "stale" ? "stale" : isT ? "tainted" : "valid";
          const statusText = { superseded: "Replaced", stale: "Stale", tainted: "Untrusted", valid: "Current" }[status];
          const deps = info.parents.get(n.id) ?? 0;
          return (
            <button key={n.id} className={`lcard ${status} ${selected === n.id ? "sel" : ""}`} onClick={() => onSelect(n.id)}>
              <div className="lhead">
                <span className={`lkind ${n.kind}`}>{KIND_LABEL[n.kind]}</span>
                <span className={`lstat ${status}`}>{statusText}</span>
                {n.kind === "action" && n.executed_at && <span className="lstat done">Already done</span>}
                {n.kind === "action" && !n.executed_at && n.gate === "blocked" && <span className="lstat tainted">Blocked</span>}
                <span className="grow" />
                <span className="muted small">{day(n.created_at)}</span>
              </div>
              <div className={`ltext ${n.status === "superseded" ? "struck" : ""}`}>{n.content}</div>
              {old && info.byId.get(old) && (
                <div className="lold">
                  was <s>{info.byId.get(old)!.content}</s>
                </div>
              )}
              {n.status === "stale" && n.stale_reason && <div className="lwarn">{n.stale_reason}</div>}
              <div className="lfoot">
                {src ? (
                  <span className="lsrc">
                    <i className="dot" style={{ background: src.trust === "untrusted" ? "var(--tainted)" : "var(--valid)" }} />
                    {src.name}
                    {ev?.author ? ` · ${ev.author}` : ""}
                  </span>
                ) : deps ? (
                  <span className="lsrc">built on {deps} thing{deps === 1 ? "" : "s"}</span>
                ) : null}
                {ev?.quote && n.kind === "fact" && <span className="lquote">“{ev.quote}”</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
