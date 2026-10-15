"use client";

import { graphlib, layout } from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useEffect, useMemo, useRef } from "react";
import type { NodeRec, SourceRec } from "@/lib/types";
import type { Snapshot } from "./api";
import { useTheme } from "./theme";

export type Focus = { why: Set<string>; impact: Set<string> };

interface GData extends Record<string, unknown> {
  kind: "source" | NodeRec["kind"];
  rec: NodeRec | SourceRec;
  tainted: boolean;
  flash: number | null; // stagger delay (ms) when the node just changed
  dim: boolean;
  sel: boolean;
  why: boolean;
  impact: boolean;
  /** Where a fact came from, shown on the card so source boxes are optional. */
  src?: { name: string; untrusted: boolean };
}

const KIND_LABEL: Record<string, string> = {
  fact: "Fact",
  belief: "Belief",
  decision: "Decision",
  action: "Action",
  source: "Source",
};

const GNode = memo(function GNode({ data }: NodeProps<Node<GData>>) {
  const d = data;
  const isSource = d.kind === "source";
  const n = d.rec as NodeRec;
  const s = d.rec as SourceRec;
  const cls = ["gnode"];
  if (isSource) {
    cls.push("source");
    if (s.trust === "untrusted") cls.push("untrusted");
  } else {
    cls.push(n.status);
    if (d.tainted) cls.push("tainted");
    if (n.gate === "blocked") cls.push("blocked");
  }
  if (d.sel) cls.push("sel");
  else if (d.why) cls.push("why");
  else if (d.impact) cls.push("impact");
  if (d.dim) cls.push("dim");
  if (d.flash !== null) cls.push("flash");

  return (
    <div className={cls.join(" ")} style={{ ["--delay" as string]: `${d.flash ?? 0}ms` }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="kind">
        <span>{KIND_LABEL[d.kind]}</span>
        <span className="mono">{d.rec.id.length > 14 ? d.rec.id.slice(0, 12) + "…" : d.rec.id}</span>
      </div>
      <div className="text">{isSource ? s.name : n.content}</div>
      {d.src && (
        <div className="gsrc">
          <i className="dot" style={{ background: d.src.untrusted ? "var(--tainted)" : "var(--valid)" }} />
          {d.src.name}
        </div>
      )}
      <div className="flags">
        {isSource ? (
          <span className="flag" style={{ color: s.trust === "untrusted" ? "var(--tainted)" : "var(--muted)" }}>
            {s.type.toUpperCase()} · {s.trust.toUpperCase()}
          </span>
        ) : (
          <>
            {n.status === "stale" && <span className="flag" style={{ color: "var(--stale)" }}>STALE</span>}
            {n.status === "superseded" && <span className="flag" style={{ color: "var(--superseded)" }}>OLD VERSION</span>}
            {d.tainted && <span className="flag" style={{ color: "var(--tainted)" }}>TAINTED</span>}
            {n.kind === "action" && n.gate === "blocked" && !n.executed_at && (
              <span className="flag" style={{ color: "var(--tainted)" }}>BLOCKED</span>
            )}
            {n.gate === "approved" && <span className="flag" style={{ color: "var(--valid)" }}>APPROVED</span>}
            {n.executed_at && <span className="flag" style={{ color: "var(--accent)" }}>EXECUTED</span>}
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
});

const nodeTypes = { g: GNode };

function layoutGraph(nodes: Node<GData>[], edges: Edge[]) {
  const g = new graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 22, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const size = (n: Node<GData>) => (n.data.kind === "source" ? { w: 210, h: 70 } : { w: 290, h: 118 });
  for (const n of nodes) g.setNode(n.id, { width: size(n).w, height: size(n).h });
  for (const e of edges) g.setEdge(e.source, e.target);
  layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const { w, h } = size(n);
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
  });
}

/** BFS over DEPENDS_ON; "down" = ancestors (what it relies on), "up" = dependents. */
export function reach(snap: Snapshot, start: string, dir: "down" | "up") {
  const next = new Map<string, string[]>();
  for (const e of snap.edges) {
    if (e.type !== "DEPENDS_ON") continue;
    const [a, b] = dir === "down" ? [e.from, e.to] : [e.to, e.from];
    next.set(a, [...(next.get(a) ?? []), b]);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    for (const n of next.get(stack.pop()!) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

function Inner(props: {
  snap: Snapshot;
  selected: string | null;
  onSelect: (id: string | null) => void;
  showOld: boolean;
  changed: Map<string, number>;
  showSources?: boolean;
  connectedOnly?: boolean;
}) {
  const { snap, selected, onSelect, showOld, changed, showSources = false, connectedOnly = true } = props;
  const rf = useReactFlow();
  const theme = useTheme();
  const dark = theme === "dark";

  const focus = useMemo(() => {
    if (!selected) return null;
    return { why: reach(snap, selected, "down"), impact: reach(snap, selected, "up") };
  }, [snap, selected]);

  const { nodes, edges } = useMemo(() => {
    const tainted = new Set(snap.tainted);
    const hidden = new Set(showOld ? [] : snap.nodes.filter((n) => n.status === "superseded").map((n) => n.id));
    // Facts nothing depends on and that depend on nothing are noise in a graph; the List view has them all.
    // If nothing is linked yet (facts only, no plans built on them), hiding the unlinked would leave a blank canvas.
    const linked = new Set<string>();
    for (const e of snap.edges) if (e.type === "DEPENDS_ON" || e.type === "SUPERSEDES") (linked.add(e.from), linked.add(e.to));
    const anyLinked = snap.nodes.some((n) => linked.has(n.id) && !hidden.has(n.id));
    if (connectedOnly && anyLinked) {
      for (const n of snap.nodes) if (!linked.has(n.id) && !tainted.has(n.id) && n.id !== selected) hidden.add(n.id);
    }
    const srcOf = new Map<string, { name: string; untrusted: boolean }>();
    const srcRec = new Map(snap.sources.map((x) => [x.id, x]));
    for (const e of snap.edges) {
      const r = e.type === "FROM" ? srcRec.get(e.to) : undefined;
      if (r) srcOf.set(e.from, { name: r.name, untrusted: r.trust === "untrusted" });
    }
    const inFocus = (id: string) =>
      !focus || id === selected || focus.why.has(id) || focus.impact.has(id);
    // Only highlight a source if one of its facts in the "why" set cites it.
    const citedSources = new Set<string>();
    if (focus) {
      for (const e of snap.edges) {
        if (e.type === "FROM" && (e.from === selected || focus.why.has(e.from))) citedSources.add(e.to);
      }
    }

    const ns: Node<GData>[] = [
      ...(showSources ? snap.sources : []).map((s) => ({
        id: s.id,
        type: "g",
        position: { x: 0, y: 0 },
        data: {
          kind: "source" as const,
          rec: s,
          tainted: false,
          flash: changed.has(s.id) ? changed.get(s.id)! : null,
          dim: !!focus && !citedSources.has(s.id),
          sel: selected === s.id,
          why: citedSources.has(s.id),
          impact: false,
        },
      })),
      ...snap.nodes
        .filter((n) => !hidden.has(n.id))
        .map((n) => ({
          id: n.id,
          type: "g",
          position: { x: 0, y: 0 },
          data: {
            kind: n.kind,
            rec: n,
            tainted: tainted.has(n.id),
            flash: changed.has(n.id) ? changed.get(n.id)! : null,
            dim: !inFocus(n.id),
            sel: selected === n.id,
            why: !!focus && focus.why.has(n.id),
            impact: !!focus && focus.impact.has(n.id),
            src: srcOf.get(n.id),
          },
        })),
    ];
    const present = new Set(ns.map((n) => n.id));
    const es: Edge[] = [];
    for (const e of snap.edges) {
      // Draw arrows in the direction of "flows into": dependency -> dependent, source -> fact, old -> new.
      const source = e.type === "SUPERSEDES" ? e.to : e.to;
      const target = e.from;
      if (!present.has(source) || !present.has(target)) continue;
      const cls: string[] = [e.type === "SUPERSEDES" ? "sup" : e.type === "FROM" ? "from" : ""];
      if (focus) {
        const both = (set: Set<string>) =>
          (source === selected || set.has(source)) && (target === selected || set.has(target));
        if (e.type === "DEPENDS_ON" && both(focus.why)) cls.push("why");
        else if (e.type === "DEPENDS_ON" && both(focus.impact)) cls.push("impact");
        else if (e.type === "FROM" && (target === selected || focus.why.has(target))) cls.push("why");
        else cls.push("dim");
      }
      es.push({
        id: `${e.type}:${e.from}>${e.to}`,
        source,
        target,
        className: cls.filter(Boolean).join(" "),
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: dark ? "#7f9a88" : "#6d7c72" },
      });
    }
    return { nodes: layoutGraph(ns, es), edges: es };
  }, [snap, focus, selected, showOld, changed, showSources, connectedOnly, dark]);

  // Re-fit when the set of nodes changes (not on every selection).
  const sig = useRef("");
  useEffect(() => {
    const next = nodes.map((n) => n.id).join("|");
    if (next !== sig.current) {
      sig.current = next;
      requestAnimationFrame(() => rf.fitView({ padding: 0.12, duration: 400, minZoom: 0.45, maxZoom: 1 }));
    }
  }, [nodes, rf]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id === selected ? null : n.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      colorMode={theme}
    >
      <Background color={dark ? "#27402f" : "#cdd5c9"} gap={22} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        style={{ width: 280, height: 190 }}
        nodeStrokeWidth={3}
        nodeBorderRadius={4}
        ariaLabel="Overview of the whole graph"
        maskColor={dark ? "#0d1711cc" : "#eef1ebcc"}
        nodeColor={(n) => {
          const d = n.data as GData;
          if (d.kind === "source") return dark ? "#4a6252" : "#aeb8ab";
          const r = d.rec as NodeRec;
          if (d.tainted) return dark ? "#ff7066" : "#c42e26";
          return r.status === "stale" ? "#eba93f" : r.status === "superseded" ? "#7b8c80" : dark ? "#62d487" : "#2e7d46";
        }}
      />
    </ReactFlow>
  );
}

export default function GraphView(props: React.ComponentProps<typeof Inner>) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
