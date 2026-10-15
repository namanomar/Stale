/**
 * Differential test: apply long random operation sequences to the real FalkorDB-backed
 * engine and to a tiny in-memory reference model, and require them to agree after every step
 * (statuses, taint set, action gates, success/failure of each op), plus structural invariants.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StaleError } from "../src/lib/errors";
import type { Kind } from "../src/lib/types";
import { checkInvariants, cleanupAfterAll, fresh } from "./helpers";

cleanupAfterAll();

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type MStatus = "valid" | "stale" | "superseded";
interface MNode {
  id: string;
  kind: Kind;
  status: MStatus;
  deps: Set<string>;
  sources: Set<string>;
  executed: boolean;
  created: number;
}

class Model {
  nodes = new Map<string, MNode>();
  untrusted = new Set<string>();
  succ = new Map<string, string>(); // old -> new
  clock = 0;

  add(n: Omit<MNode, "created" | "status" | "executed">) {
    this.nodes.set(n.id, { ...n, status: "valid", executed: false, created: this.clock++ });
  }
  valid(kind?: Kind) {
    return [...this.nodes.values()].filter((n) => n.status === "valid" && (!kind || n.kind === kind));
  }
  descendants(root: string) {
    const out = new Set<string>();
    let frontier = [root];
    while (frontier.length) {
      const next: string[] = [];
      for (const n of this.nodes.values()) {
        if (out.has(n.id)) continue;
        if ([...n.deps].some((d) => frontier.includes(d))) {
          out.add(n.id);
          next.push(n.id);
        }
      }
      frontier = next;
    }
    return out;
  }
  ancestorsOrSelf(id: string) {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      for (const d of this.nodes.get(stack.pop()!)!.deps) {
        if (!out.has(d)) {
          out.add(d);
          stack.push(d);
        }
      }
    }
    return out;
  }
  tainted() {
    const seeds = [...this.nodes.values()].filter((n) => [...n.sources].some((s) => this.untrusted.has(s)));
    const out = new Set(seeds.map((s) => s.id));
    for (const s of seeds) for (const d of this.descendants(s.id)) out.add(d);
    return out;
  }
  /** Firewall verdict: nothing at-or-above `id` is non-valid or tainted. */
  allowed(id: string) {
    const taint = this.tainted();
    return [...this.ancestorsOrSelf(id)].every((a) => this.nodes.get(a)!.status === "valid") && !taint.has(id);
  }
  supersede(id: string, newId: string) {
    const old = this.nodes.get(id)!;
    this.add({ id: newId, kind: old.kind, deps: new Set(old.deps), sources: new Set(old.sources) });
    old.status = "superseded";
    this.succ.set(id, newId);
    for (const d of this.descendants(id)) {
      const n = this.nodes.get(d)!;
      if (n.status === "valid") n.status = "stale";
    }
  }
  /** Returns null on success, or a reason it must fail. */
  resolve(id: string): string | null {
    const n = this.nodes.get(id)!;
    if (n.status !== "stale") return "not-stale";
    const rebase: [string, string][] = [];
    for (const p of n.deps) {
      const ps = this.nodes.get(p)!;
      if (ps.status === "valid") continue;
      if (ps.status === "stale") return "parent-stale";
      let cur = this.succ.get(p);
      let best: string | undefined;
      while (cur) {
        if (this.nodes.get(cur)!.status === "valid") best = cur;
        cur = this.succ.get(cur);
      }
      if (!best) return "no-successor";
      rebase.push([p, best]);
    }
    for (const [from, to] of rebase) {
      n.deps.delete(from);
      n.deps.add(to);
    }
    n.status = "valid";
    return null;
  }
}

async function run(seed: number, steps: number) {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const mem = await fresh(`fz${seed}`);
  const model = new Model();
  const sources = ["sa", "sb", "sc"];
  for (const s of sources) await mem.addSource({ id: s, name: s });
  const log: string[] = [];
  const seen: Record<string, number> = {};

  const expectFail = async (p: Promise<unknown>, what: string) => {
    await assert.rejects(p, (e: unknown) => e instanceof StaleError && e.status >= 400 && e.status < 500, what);
  };

  for (let step = 0; step < steps; step++) {
    const roll = r();
    let op = "";
    if (roll < 0.2 || model.nodes.size < 3) {
      const src = pick(sources);
      const { node } = await mem.addNode({ kind: "fact", content: `fact ${step}`, sourceId: src });
      model.add({ id: node.id, kind: "fact", deps: new Set(), sources: new Set([src]) });
      op = `fact ${node.id}`;
    } else if (roll < 0.5) {
      const parents = model.valid();
      const deps = [...new Set(Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(parents).id))];
      const kind = pick<Kind>(["belief", "decision", "action"]);
      const { node } = await mem.addNode({ kind, content: `${kind} ${step}`, dependsOn: deps });
      model.add({ id: node.id, kind, deps: new Set(deps), sources: new Set() });
      op = `${kind} ${node.id} <- ${deps}`;
    } else if (roll < 0.65) {
      const target = pick(model.valid());
      const res = await mem.supersede(target.id, { content: `v${step}` });
      model.supersede(target.id, res.node.id);
      op = `supersede ${target.id} -> ${res.node.id}`;
    } else if (roll < 0.82) {
      const staleNodes = [...model.nodes.values()].filter((n) => n.status === "stale");
      if (!staleNodes.length) continue;
      const target = pick(staleNodes);
      const why = model.resolve(target.id);
      op = `resolve ${target.id} (${why ?? "ok"})`;
      if (why) await expectFail(mem.resolve(target.id), op);
      else await mem.resolve(target.id);
    } else if (roll < 0.9) {
      const s = pick(sources);
      const bad = !model.untrusted.has(s);
      if (bad) model.untrusted.add(s);
      else model.untrusted.delete(s);
      await mem.setTrust(s, bad ? "untrusted" : "trusted");
      op = `${bad ? "quarantine" : "restore"} ${s}`;
    } else if (roll < 0.95) {
      const acts = model.valid("action").filter((a) => !a.executed);
      const stales = [...model.nodes.values()].filter((n) => n.kind === "action" && n.status === "stale" && !n.executed);
      const pool = [...acts, ...stales];
      if (!pool.length) continue;
      const a = pick(pool);
      op = `execute ${a.id}`;
      if (model.allowed(a.id)) {
        await mem.executeAction(a.id);
        a.executed = true;
      } else {
        await assert.rejects(mem.executeAction(a.id), (e: unknown) => e instanceof StaleError && e.status === 403, op);
      }
    } else {
      // building on a non-valid node must always be refused and leave no trace
      const bad = [...model.nodes.values()].filter((n) => n.status !== "valid");
      if (!bad.length) continue;
      const target = pick(bad);
      const before = (await mem.snapshot()).nodes.length;
      await expectFail(mem.addNode({ kind: "belief", content: "x", dependsOn: [target.id] }), `build on ${target.id}`);
      assert.equal((await mem.snapshot()).nodes.length, before);
      op = `refused build on ${target.id}`;
    }
    log.push(`${step}: ${op}`);
    const k = op.split(" ")[0];
    seen[k] = (seen[k] ?? 0) + 1;

    const snap = await mem.snapshot();
    const ctx = `seed ${seed} step ${step} [${op}]\n${log.slice(-12).join("\n")}`;
    assert.equal(snap.nodes.length, model.nodes.size, `node count; ${ctx}`);
    for (const n of snap.nodes) {
      const m = model.nodes.get(n.id);
      assert.ok(m, `unknown node ${n.id}; ${ctx}`);
      assert.equal(n.status, m.status, `status of ${n.id}; ${ctx}`);
    }
    assert.deepEqual([...snap.tainted].sort(), [...model.tainted()].sort(), `taint set; ${ctx}`);
    const taint = model.tainted();
    for (const n of snap.nodes) {
      const m = model.nodes.get(n.id)!;
      if (m.kind === "action" && m.status !== "superseded" && !m.executed) {
        const expected = model.allowed(n.id) ? "allowed" : "blocked";
        assert.equal(n.gate, expected, `gate of ${n.id} (tainted=${taint.has(n.id)}); ${ctx}`);
      }
    }
    if (step % 10 === 9) await checkInvariants(mem);
  }
  await checkInvariants(mem);
  return { model, seen };
}

describe("differential fuzz against a reference model", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: 90 random operations`, async () => {
      const { model, seen } = await run(seed, 90);
      assert.ok(model.nodes.size > 10);
      for (const k of ["fact", "supersede", "quarantine"]) assert.ok(seen[k] > 0, `never exercised ${k}: ${JSON.stringify(seen)}`);
      assert.ok((seen.resolve ?? 0) + (seen.execute ?? 0) > 0, `no repairs/executions: ${JSON.stringify(seen)}`);
    });
  }
});
