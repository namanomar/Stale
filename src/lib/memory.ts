import { randomUUID } from "node:crypto";
import { graphFor, dropTenant } from "./db";
import { badRequest, conflict, notFound, StaleError } from "./errors";
import type {
  EdgeRec,
  GateReason,
  GateVerdict,
  ImpactItem,
  Kind,
  NodeRec,
  SourceRec,
  Trust,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const now = () => Date.now();
const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;
const PREFIX: Record<Kind, string> = { fact: "f", belief: "b", decision: "d", action: "a" };

function toNode(p: Row): NodeRec {
  const { meta, ...rest } = p;
  const out = { ...rest } as NodeRec;
  if (typeof meta === "string") {
    try {
      out.meta = JSON.parse(meta);
    } catch {
      /* ignore malformed meta */
    }
  }
  return out;
}

export interface AddNodeInput {
  id?: string;
  kind: Kind;
  content: string;
  dependsOn?: string[];
  sourceId?: string;
  confidence?: number;
  meta?: Record<string, unknown>;
}

/**
 * Tenant-scoped belief graph.
 *
 * Model: (Node)-[:DEPENDS_ON]->(Node) points from a derived item to what it
 * relied on. (Node)-[:FROM]->(Source) is provenance. (new)-[:SUPERSEDES]->(old)
 * is versioning. Staleness is propagated by reachability over DEPENDS_ON;
 * taint is computed live as reachability to an untrusted Source, so it can be
 * lifted again by re-trusting the source.
 */
export class Memory {
  private constructor(
    readonly tenant: string,
    private graph: Awaited<ReturnType<typeof graphFor>>,
  ) {}

  static async open(tenant: string) {
    return new Memory(tenant, await graphFor(tenant));
  }

  private async run(cypher: string, params: Row = {}): Promise<Row[]> {
    const res = await this.graph.query<Row>(cypher, { params });
    return res.data ?? [];
  }

  private async ro(cypher: string, params: Row = {}): Promise<Row[]> {
    const res = await this.graph.roQuery<Row>(cypher, { params });
    return res.data ?? [];
  }

  /**
   * Level-by-level BFS over DEPENDS_ON. Variable-length Cypher paths enumerate
   * every path (2^n on a ladder of diamonds); this visits each node once.
   *  - "up":   dependents (things built on the start nodes)
   *  - "down": ancestors (things the start nodes rely on)
   * `via` is the node we came from, so a path can be rebuilt.
   */
  private async bfs(
    start: string[],
    dir: "up" | "down",
  ): Promise<Map<string, { depth: number; via?: string }>> {
    const seen = new Map<string, { depth: number; via?: string }>();
    for (const s of start) seen.set(s, { depth: 0 });
    let frontier = [...new Set(start)];
    const q =
      dir === "up"
        ? "MATCH (d:Node)-[:DEPENDS_ON]->(p:Node) WHERE p.id IN $ids RETURN d.id AS id, p.id AS via"
        : "MATCH (c:Node)-[:DEPENDS_ON]->(p:Node) WHERE c.id IN $ids RETURN p.id AS id, c.id AS via";
    for (let depth = 1; frontier.length; depth++) {
      const next: string[] = [];
      for (const r of await this.ro(q, { ids: frontier })) {
        if (!seen.has(r.id)) {
          seen.set(r.id, { depth, via: r.via });
          next.push(r.id);
        }
      }
      frontier = next;
    }
    return seen;
  }

  private async propsOf(ids: string[]): Promise<Map<string, NodeRec>> {
    const out = new Map<string, NodeRec>();
    if (!ids.length) return out;
    const rows = await this.ro("MATCH (n:Node) WHERE n.id IN $ids RETURN properties(n) AS n", { ids });
    for (const r of rows) out.set(r.n.id, toNode(r.n));
    return out;
  }

  private async impactOf(reach: Map<string, { depth: number }>, skip?: string): Promise<ImpactItem[]> {
    const props = await this.propsOf([...reach.keys()]);
    // Retired versions are history, not something anyone needs to act on.
    const ids = [...reach.keys()].filter((i) => i !== skip && props.get(i)!.status !== "superseded");
    return ids
      .map((id) => {
        const n = props.get(id)!;
        return {
          id,
          kind: n.kind,
          content: n.content,
          status: n.status,
          depth: reach.get(id)!.depth,
          executed: n.executed_at != null,
        };
      })
      .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  }

  private async log(type: string, payload: Row, nodeId?: string) {
    await this.run(
      "CREATE (:Event {id:$id, type:$type, node_id:$nodeId, payload:$payload, ts:$ts})",
      {
        id: newId("e"),
        type,
        nodeId: nodeId ?? "",
        payload: JSON.stringify(payload),
        ts: now(),
      },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Sources                                                             */
  /* ------------------------------------------------------------------ */

  async addSource(input: {
    id?: string;
    name: string;
    type?: string;
    trust?: Trust;
  }): Promise<SourceRec> {
    const id = input.id ?? newId("s");
    const rec = {
      id,
      name: input.name,
      type: input.type ?? "unknown",
      trust: input.trust ?? "trusted",
      created_at: now(),
    };
    // Create-if-absent in one statement; FalkorDB serialises writes per graph.
    const made = await this.run(
      `OPTIONAL MATCH (e:Source {id:$id}) WITH e WHERE e IS NULL
       CREATE (s:Source {id:$id, name:$name, type:$type, trust:$trust, created_at:$created_at})
       RETURN s.id AS id`,
      rec,
    );
    if (!made.length) throw conflict(`Source '${id}' already exists`);
    await this.log("source_added", rec);
    return rec as SourceRec;
  }

  async getSource(id: string): Promise<SourceRec> {
    const rows = await this.ro("MATCH (s:Source {id:$id}) RETURN properties(s) AS s", { id });
    if (!rows.length) throw notFound("Source", id);
    return rows[0].s as SourceRec;
  }

  async listSources(): Promise<SourceRec[]> {
    const rows = await this.ro("MATCH (s:Source) RETURN properties(s) AS s ORDER BY s.created_at");
    return rows.map((r) => r.s as SourceRec);
  }

  async hasSource(id: string) {
    return (await this.ro("MATCH (s:Source {id:$id}) RETURN s.id AS id", { id })).length > 0;
  }

  /** Attach another citation to a node (a second message saying the same thing). */
  async addEvidence(id: string, evidence: Record<string, unknown>) {
    const node = await this.getNode(id);
    const list = Array.isArray(node.meta?.evidence) ? (node.meta!.evidence as unknown[]) : [];
    const meta = { ...(node.meta ?? {}), evidence: [...list, evidence].slice(-25) };
    await this.run("MATCH (n:Node {id:$id}) SET n.meta=$meta", { id, meta: JSON.stringify(meta) });
    await this.log("evidence_added", { evidence }, id);
  }

  /** Mark a source untrusted (or trusted again). Taint follows by reachability. */
  async setTrust(id: string, trust: Trust, reason?: string) {
    await this.getSource(id);
    await this.run("MATCH (s:Source {id:$id}) SET s.trust=$trust, s.trust_reason=$reason", {
      id,
      trust,
      reason: reason ?? "",
    });
    await this.log(
      trust === "untrusted" ? "source_quarantined" : "source_restored",
      { id, reason },
      id,
    );
    await this.refreshGates();

    const tainted = await this.derivedFromSource(id);
    return {
      source: await this.getSource(id),
      affected: tainted,
      executedActions: tainted.filter((n) => n.kind === "action" && n.executed),
      blockedActions: tainted.filter((n) => n.kind === "action" && !n.executed),
    };
  }

  /** Everything that (transitively) derives from facts of this source. */
  private async derivedFromSource(sourceId: string): Promise<ImpactItem[]> {
    const direct = await this.ro("MATCH (:Source {id:$id})<-[:FROM]-(f:Node) RETURN f.id AS id", {
      id: sourceId,
    });
    return this.impactOf(await this.bfs(direct.map((r) => r.id), "up"));
  }

  /* ------------------------------------------------------------------ */
  /* Nodes                                                               */
  /* ------------------------------------------------------------------ */

  async getNode(id: string): Promise<NodeRec> {
    const rows = await this.ro("MATCH (n:Node {id:$id}) RETURN properties(n) AS n", { id });
    if (!rows.length) throw notFound("Node", id);
    return toNode(rows[0].n);
  }

  async addNode(input: AddNodeInput) {
    const deps = [...new Set(input.dependsOn ?? [])];
    if (input.kind !== "fact" && deps.length === 0) {
      throw badRequest(
        `A ${input.kind} must depend on at least one node (provenance is the point)`,
      );
    }
    if (input.kind === "fact" && !input.sourceId && deps.length === 0) {
      throw badRequest("A fact needs a sourceId (where did you learn it?)");
    }
    if (input.sourceId) await this.getSource(input.sourceId);

    const blockers: Row[] = [];
    for (const d of deps) {
      const parent = await this.getNode(d);
      if (parent.status !== "valid") blockers.push({ id: d, status: parent.status });
    }
    if (blockers.length) {
      throw conflict("Cannot build on stale or superseded nodes", { blockers });
    }

    const id = input.id ?? newId(PREFIX[input.kind]);
    const t = now();
    const made = await this.run(
      `OPTIONAL MATCH (e:Node {id:$id}) WITH e WHERE e IS NULL
       CREATE (n:Node {id:$id, kind:$kind, content:$content, status:'valid',
                       confidence:$confidence, created_at:$t, updated_at:$t, meta:$meta})
       RETURN n.id AS id`,
      {
        id,
        kind: input.kind,
        content: input.content,
        confidence: input.confidence ?? 1,
        t,
        meta: JSON.stringify(input.meta ?? {}),
      },
    );
    if (!made.length) throw conflict(`Node '${id}' already exists`);
    if (deps.length) {
      // Re-check validity atomically with linking: a parent superseded since the
      // check above must not gain a "valid" child. Roll back if any link is refused.
      const linked = await this.run(
        `MATCH (n:Node {id:$id}) UNWIND $deps AS d
         MATCH (p:Node {id:d}) WHERE p.status = 'valid'
         CREATE (n)-[:DEPENDS_ON]->(p) RETURN count(p) AS c`,
        { id, deps },
      );
      if (Number(linked[0]?.c ?? 0) !== deps.length) {
        await this.run("MATCH (n:Node {id:$id}) DETACH DELETE n", { id });
        throw conflict("A dependency changed while the node was being added; retry");
      }
    }
    if (input.sourceId) {
      await this.run("MATCH (n:Node {id:$id}), (s:Source {id:$sid}) CREATE (n)-[:FROM]->(s)", {
        id,
        sid: input.sourceId,
      });
    }
    await this.log("node_added", { kind: input.kind, content: input.content, deps }, id);

    let gate: GateVerdict | undefined;
    if (input.kind === "action") {
      gate = await this.checkAction(id);
      await this.run("MATCH (n:Node {id:$id}) SET n.gate=$gate", {
        id,
        gate: gate.allowed ? "allowed" : "blocked",
      });
      await this.log(
        gate.allowed ? "action_allowed" : "action_blocked",
        { reasons: gate.reasons },
        id,
      );
    }
    return { node: await this.getNode(id), gate };
  }

  /* ------------------------------------------------------------------ */
  /* Staleness                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * A fact (or any node) changed. Create the new version, retire the old
   * one, and cascade staleness to everything that depended on it.
   */
  async supersede(
    id: string,
    input: {
      content: string;
      reason?: string;
      sourceId?: string;
      confidence?: number;
      meta?: Record<string, unknown>;
    },
  ) {
    const old = await this.getNode(id);
    if (old.status === "superseded") throw conflict(`Node '${id}' is already superseded`);
    if (old.status === "stale") {
      throw conflict(`Node '${id}' is stale; resolve it (optionally with new content) instead`);
    }
    if (input.sourceId) await this.getSource(input.sourceId);
    const reason = input.reason ?? "upstream change";

    const newNodeId = newId(PREFIX[old.kind]);
    const t = now();
    const made = await this.run(
      `MATCH (o:Node {id:$old}) WHERE o.status = 'valid'
       CREATE (n:Node {id:$id, kind:o.kind, content:$content, status:'valid',
                       confidence:$confidence, created_at:$t, updated_at:$t, meta:$meta})
       CREATE (n)-[:SUPERSEDES]->(o)
       SET o.status='superseded', o.updated_at=$t, o.stale_reason=$reason
       RETURN n.id AS id`,
      {
        old: id,
        id: newNodeId,
        content: input.content,
        confidence: input.confidence ?? old.confidence,
        meta: JSON.stringify(input.meta ?? old.meta ?? {}),
        t,
        reason,
      },
    );
    // Lost a race with a concurrent supersede/cascade.
    if (!made.length) throw conflict(`Node '${id}' changed concurrently; retry`);
    // Provenance of the new version: the given source, else inherit the old one's.
    if (input.sourceId) {
      await this.run("MATCH (n:Node {id:$id}), (s:Source {id:$sid}) CREATE (n)-[:FROM]->(s)", {
        id: newNodeId,
        sid: input.sourceId,
      });
    } else {
      await this.run(
        "MATCH (n:Node {id:$id}), (o:Node {id:$old})-[:FROM]->(s:Source) CREATE (n)-[:FROM]->(s)",
        { id: newNodeId, old: id },
      );
    }
    // A derived node keeps its own dependencies when a new version replaces it.
    await this.run(
      `MATCH (n:Node {id:$id}), (o:Node {id:$old})-[:DEPENDS_ON]->(p:Node)
       WHERE p.status = 'valid' CREATE (n)-[:DEPENDS_ON]->(p)`,
      { id: newNodeId, old: id },
    );

    const impacted = await this.cascadeStale(id, reason);
    await this.log("superseded", { old: id, new: newNodeId, reason, impacted: impacted.length }, id);
    await this.refreshGates();

    return {
      previous: await this.getNode(id),
      node: await this.getNode(newNodeId),
      impacted,
      executedActionsAtRisk: impacted.filter((i) => i.kind === "action" && i.executed),
    };
  }

  /** Mark every still-valid descendant of `rootId` stale. Returns them with depth. */
  private async cascadeStale(rootId: string, reason: string): Promise<ImpactItem[]> {
    const reach = await this.bfs([rootId], "up");
    reach.delete(rootId);
    if (!reach.size) return [];
    const items = [...reach].map(([id, v]) => ({ id, depth: v.depth }));
    await this.run(
      `UNWIND $items AS it MATCH (d:Node {id:it.id}) WHERE d.status = 'valid'
       SET d.status='stale', d.stale_root=$root, d.stale_reason=$reason,
           d.stale_depth=it.depth, d.updated_at=$t`,
      { items, root: rootId, reason, t: now() },
    );
    // Report everything that was or already is downstream, marking real transitions only.
    return this.impactOf(reach);
  }

  /** What would break if this node changed? (read-only blast radius) */
  async impact(id: string): Promise<ImpactItem[]> {
    await this.getNode(id);
    return this.impactOf(await this.bfs([id], "up"), id);
  }

  /**
   * Re-validate a stale node. Parents that were superseded are rebased onto
   * their newest valid version. Fails if any parent is itself still stale,
   * which forces repairs to happen root-first.
   */
  async resolve(id: string, input: { content?: string; note?: string } = {}) {
    const node = await this.getNode(id);
    if (node.status === "superseded") {
      throw conflict(`Node '${id}' is superseded; resolve its successor`);
    }
    if (node.status === "valid") throw conflict(`Node '${id}' is already valid`);

    const parents = await this.ro(
      "MATCH (n:Node {id:$id})-[:DEPENDS_ON]->(p:Node) RETURN p.id AS id, p.status AS status",
      { id },
    );
    const blockers: Row[] = [];
    const rebase: { from: string; to: string }[] = [];
    for (const p of parents) {
      if (p.status === "valid") continue;
      if (p.status === "stale") {
        blockers.push({ id: p.id, reason: "parent is still stale; repair it first" });
        continue;
      }
      const succ = await this.ro(
        `MATCH (o:Node {id:$id})<-[:SUPERSEDES*1..]-(s:Node) WHERE s.status = 'valid'
         RETURN s.id AS id ORDER BY s.created_at DESC LIMIT 1`,
        { id: p.id },
      );
      if (succ.length) rebase.push({ from: p.id, to: succ[0].id });
      else blockers.push({ id: p.id, reason: "parent was retired with no valid replacement" });
    }
    if (blockers.length) throw conflict("Cannot resolve yet", { blockers });

    for (const r of rebase) {
      await this.run(
        `MATCH (n:Node {id:$id})-[e:DEPENDS_ON]->(:Node {id:$from}) DELETE e
         WITH n MATCH (s:Node {id:$to}) CREATE (n)-[:DEPENDS_ON]->(s)`,
        { id, from: r.from, to: r.to },
      );
    }
    const setContent = input.content !== undefined ? ", n.content=$content" : "";
    await this.run(
      `MATCH (n:Node {id:$id}) SET n.status='valid', n.updated_at=$t${setContent}
       REMOVE n.stale_root, n.stale_reason, n.stale_depth`,
      { id, t: now(), ...(input.content !== undefined ? { content: input.content } : {}) },
    );
    await this.log("resolved", { rebase, note: input.note, content: input.content }, id);
    await this.refreshGates();
    return { node: await this.getNode(id), rebased: rebase };
  }

  /** Stale nodes grouped into layers: fix layer 0 first, then 1, ... */
  async repairPlan() {
    const stale = (
      await this.ro("MATCH (n:Node {status:'stale'}) RETURN properties(n) AS n")
    ).map((r) => toNode(r.n));
    const edges = await this.ro(
      "MATCH (a:Node {status:'stale'})-[:DEPENDS_ON]->(b:Node {status:'stale'}) RETURN a.id AS a, b.id AS b",
    );
    const rebases = await this.ro(
      `MATCH (n:Node {status:'stale'})-[:DEPENDS_ON]->(o:Node {status:'superseded'})
       OPTIONAL MATCH (o)<-[:SUPERSEDES*1..]-(s:Node) WHERE s.status = 'valid'
       RETURN n.id AS node, o.id AS old, o.content AS oldContent, s.id AS new, s.content AS newContent`,
    );

    const parentsOf = new Map<string, string[]>();
    for (const e of edges) parentsOf.set(e.a, [...(parentsOf.get(e.a) ?? []), e.b]);
    const layerOf = new Map<string, number>();
    const layer = (id: string): number => {
      if (layerOf.has(id)) return layerOf.get(id)!;
      const ps = parentsOf.get(id) ?? [];
      const l = ps.length ? 1 + Math.max(...ps.map(layer)) : 0;
      layerOf.set(id, l);
      return l;
    };
    const layers: { layer: number; nodes: (NodeRec & { rebase: Row[] })[] }[] = [];
    for (const n of stale) {
      const l = layer(n.id);
      (layers[l] ??= { layer: l, nodes: [] }).nodes.push({
        ...n,
        rebase: rebases
          .filter((r) => r.node === n.id)
          .map((r) => ({
            from: r.old,
            fromContent: r.oldContent,
            to: r.new,
            toContent: r.newContent,
          })),
      });
    }
    return {
      total: stale.length,
      executedActionsAtRisk: stale.filter((n) => n.kind === "action" && n.executed_at).length,
      layers: layers.filter(Boolean),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Explainability                                                      */
  /* ------------------------------------------------------------------ */

  /** Why do I believe this? The full ancestor subgraph, sources included. */
  async why(id: string) {
    const node = await this.getNode(id);
    const reach = await this.bfs([id], "down");
    const ids = [...reach.keys()];
    const props = await this.propsOf(ids);
    const anc = ids.map((i) => ({ n: props.get(i)! }));
    const srcRows = await this.ro(
      "MATCH (a:Node)-[:FROM]->(s:Source) WHERE a.id IN $ids RETURN DISTINCT properties(s) AS s",
      { ids },
    );
    const edgeRows = await this.ro(
      `MATCH (a:Node)-[r:DEPENDS_ON|FROM]->(b) WHERE a.id IN $ids
       RETURN a.id AS f, b.id AS t, type(r) AS type`,
      { ids },
    );
    return {
      node,
      ancestors: anc.map((r) => r.n).filter((n) => n.id !== id),
      sources: srcRows.map((r) => r.s as SourceRec),
      edges: edgeRows.map((r) => ({ from: r.f, to: r.t, type: r.type }) as EdgeRec),
      verdict: await this.checkAction(id),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Firewall                                                            */
  /* ------------------------------------------------------------------ */

  /** Is this node safe to act on? Walks ancestors for stale rot and untrusted taint. */
  async checkAction(id: string): Promise<GateVerdict> {
    await this.getNode(id);
    const reach = await this.bfs([id], "down");
    const ids = [...reach.keys()];
    const props = await this.propsOf(ids);
    const bad = await this.ro(
      `MATCH (a:Node)-[:FROM]->(s:Source {trust:'untrusted'}) WHERE a.id IN $ids
       RETURN a.id AS node, s.id AS source, s.name AS name`,
      { ids },
    );

    // Rebuild the path id -> ... -> ancestor from the BFS parent pointers.
    const pathTo = (target: string) => {
      const chain: string[] = [];
      for (let cur: string | undefined = target; cur !== undefined; cur = reach.get(cur)?.via) {
        chain.push(cur);
      }
      return chain.reverse().map((nid) => ({ id: nid, label: props.get(nid)?.content ?? nid }));
    };
    const byDepth = (a: { d: number; k: string }, b: { d: number; k: string }) =>
      a.d - b.d || a.k.localeCompare(b.k);

    const taint = bad
      .map((r) => ({ d: reach.get(r.node)!.depth, k: r.source + r.node, r }))
      .sort(byDepth)
      .slice(0, 5)
      .map(({ r }) => ({
        type: "tainted" as const,
        path: [...pathTo(r.node), { id: r.source as string, label: r.name as string }],
        source: r.source as string,
      }));
    const stale = ids
      .filter((i) => props.get(i)!.status !== "valid")
      .map((i) => ({ d: reach.get(i)!.depth, k: i }))
      .sort(byDepth)
      .slice(0, 5)
      .map(({ k }) => ({ type: "stale" as const, path: pathTo(k) }));
    const reasons: GateReason[] = [...taint, ...stale];
    return {
      id,
      allowed: reasons.length === 0,
      tainted: bad.length > 0,
      stale: stale.length > 0,
      reasons,
    };
  }

  /** What a human approval covers: the exact set of problems that existed at approval time. */
  private signature(v: GateVerdict) {
    return JSON.stringify(v.reasons.map((r) => `${r.type}:${r.path.map((p) => p.id).join(">")}`).sort());
  }

  /**
   * Re-evaluate the stored gate of every action that has not run yet.
   * An approval is revoked as soon as the graph shows a problem the approver did not see.
   */
  private async refreshGates() {
    const actions = await this.ro(
      `MATCH (n:Node {kind:'action'}) WHERE n.executed_at IS NULL
       RETURN n.id AS id, n.gate AS gate, n.approved_sig AS sig`,
    );
    for (const a of actions) {
      const v = await this.checkAction(a.id);
      let gate: string = v.allowed ? "allowed" : "blocked";
      if (a.gate === "approved") {
        const covered = a.sig !== undefined && a.sig !== null && this.coveredBy(a.sig, v);
        if (covered) continue;
        await this.log("approval_revoked", { reasons: v.reasons }, a.id);
        await this.run(
          "MATCH (n:Node {id:$id}) REMOVE n.approved_by, n.approval_note, n.approved_sig",
          { id: a.id },
        );
      }
      if (gate !== a.gate) {
        await this.run("MATCH (n:Node {id:$id}) SET n.gate=$gate", { id: a.id, gate });
      }
    }
  }

  /** True if every current reason was already present when the approval was given. */
  private coveredBy(approvedSig: string, v: GateVerdict) {
    const approved = new Set<string>(JSON.parse(approvedSig));
    return JSON.parse(this.signature(v)).every((r: string) => approved.has(r));
  }

  /** Human override for a blocked action. */
  async approveAction(id: string, approver: string, note?: string) {
    const node = await this.getNode(id);
    if (node.kind !== "action") throw badRequest(`'${id}' is a ${node.kind}, not an action`);
    if (node.executed_at) throw conflict(`Action '${id}' was already executed`);
    if (node.status !== "valid" && node.status !== "stale") {
      throw conflict(`Action '${id}' is superseded; approve its successor`);
    }
    const verdict = await this.checkAction(id);
    await this.run(
      `MATCH (n:Node {id:$id}) SET n.gate='approved', n.approved_by=$approver,
              n.approval_note=$note, n.approved_sig=$sig`,
      { id, approver, note: note ?? "", sig: this.signature(verdict) },
    );
    await this.log("action_approved", { approver, note, reasons: verdict.reasons }, id);
    return this.getNode(id);
  }

  /** Run an action through the firewall. Blocked actions need a human approval first. */
  async executeAction(id: string) {
    const node = await this.getNode(id);
    if (node.kind !== "action") throw badRequest(`'${id}' is a ${node.kind}, not an action`);
    if (node.executed_at) throw conflict(`Action '${id}' was already executed`);
    const verdict = await this.checkAction(id);
    const approved =
      node.gate === "approved" && this.coveredBy(node.approved_sig ?? "[]", verdict);
    if (!verdict.allowed && !approved) {
      await this.log("action_refused", { reasons: verdict.reasons }, id);
      throw new StaleError(403, "Action blocked by the firewall; needs human approval", verdict);
    }
    await this.run("MATCH (n:Node {id:$id}) SET n.executed_at=$t", { id, t: now() });
    await this.log("action_executed", { overridden: !verdict.allowed }, id);
    return { node: await this.getNode(id), verdict };
  }

  /* ------------------------------------------------------------------ */
  /* Read models for UI / MCP                                            */
  /* ------------------------------------------------------------------ */

  async snapshot() {
    const nodes = (
      await this.ro("MATCH (n:Node) RETURN properties(n) AS n ORDER BY n.created_at")
    ).map((r) => toNode(r.n));
    const sources = await this.listSources();
    const edges = (
      await this.ro(
        "MATCH (a)-[r:DEPENDS_ON|FROM|SUPERSEDES]->(b) RETURN a.id AS f, b.id AS t, type(r) AS type",
      )
    ).map((r) => ({ from: r.f, to: r.t, type: r.type }) as EdgeRec);
    const direct = await this.ro(
      "MATCH (:Source {trust:'untrusted'})<-[:FROM]-(f:Node) RETURN DISTINCT f.id AS id",
    );
    const tainted = [...(await this.bfs(direct.map((r) => r.id), "up")).keys()];
    const stats = {
      nodes: nodes.length,
      sources: sources.length,
      valid: nodes.filter((n) => n.status === "valid").length,
      stale: nodes.filter((n) => n.status === "stale").length,
      superseded: nodes.filter((n) => n.status === "superseded").length,
      tainted: tainted.length,
      blockedActions: nodes.filter((n) => n.kind === "action" && n.gate === "blocked").length,
      executedActions: nodes.filter((n) => n.kind === "action" && n.executed_at).length,
    };
    return { tenant: this.tenant, nodes, sources, edges, tainted, stats };
  }

  async events(limit = 50) {
    const rows = await this.ro(
      "MATCH (e:Event) RETURN properties(e) AS e ORDER BY e.ts DESC LIMIT $limit",
      { limit },
    );
    return rows.map((r) => ({ ...r.e, payload: safeParse(r.e.payload) }));
  }

  async reset() {
    await dropTenant(this.tenant);
  }
}

function toImpact(r: Row): ImpactItem {
  return {
    id: r.id,
    kind: r.kind,
    content: r.content,
    status: r.status,
    depth: Number(r.depth),
    executed: r.executed_at != null,
  };
}

function safeParse(s: unknown) {
  try {
    return JSON.parse(String(s));
  } catch {
    return s;
  }
}
