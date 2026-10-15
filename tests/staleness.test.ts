import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Memory } from "../src/lib/memory";
import { checkInvariants, cleanupAfterAll, fresh, rejectsWith, statusOf, withFacts } from "./helpers";

cleanupAfterAll();

const ids = (items: { id: string }[]) => items.map((i) => i.id).sort();

/** f1 <- b1 <- d1 <- a1, plus an unrelated f2 <- b2 */
async function chain(m: Memory) {
  await withFacts(m, "f1", "f2");
  await m.addNode({ id: "b1", kind: "belief", content: "b1", dependsOn: ["f1"] });
  await m.addNode({ id: "d1", kind: "decision", content: "d1", dependsOn: ["b1"] });
  await m.addNode({ id: "a1", kind: "action", content: "a1", dependsOn: ["d1"] });
  await m.addNode({ id: "b2", kind: "belief", content: "b2", dependsOn: ["f2"] });
}

describe("impact (dry run)", () => {
  it("lists dependents with depth and changes nothing", async () => {
    const m = await fresh("imp");
    await chain(m);
    const imp = await m.impact("f1");
    assert.deepEqual(imp.map((i) => [i.id, i.depth]), [["b1", 1], ["d1", 2], ["a1", 3]]);
    assert.equal((await m.snapshot()).stats.stale, 0);
  });

  it("is empty for leaves and 404 for unknown ids", async () => {
    const m = await fresh("imp");
    await chain(m);
    assert.deepEqual(await m.impact("a1"), []);
    await rejectsWith(m.impact("ghost"), 404);
  });

  it("reports the shortest depth in a diamond and each node once", async () => {
    const m = await fresh("imp");
    await withFacts(m, "f");
    await m.addNode({ id: "x", kind: "belief", content: "x", dependsOn: ["f"] });
    await m.addNode({ id: "y", kind: "belief", content: "y", dependsOn: ["x"] });
    await m.addNode({ id: "z", kind: "belief", content: "z", dependsOn: ["f", "y"] }); // direct AND long path
    const imp = await m.impact("f");
    assert.equal(imp.length, 3);
    assert.equal(imp.find((i) => i.id === "z")!.depth, 1);
  });

  it("flags executed actions", async () => {
    const m = await fresh("imp");
    await chain(m);
    await m.executeAction("a1");
    assert.equal((await m.impact("f1")).find((i) => i.id === "a1")!.executed, true);
  });
});

describe("supersede", () => {
  it("versions the fact and stales exactly its dependents", async () => {
    const m = await fresh("sup");
    await chain(m);
    const r = await m.supersede("f1", { content: "f1 v2", reason: "changed" });
    assert.equal(r.previous.status, "superseded");
    assert.equal(r.node.status, "valid");
    assert.equal(r.node.content, "f1 v2");
    assert.deepEqual(ids(r.impacted), ["a1", "b1", "d1"]);
    for (const x of ["b1", "d1", "a1"]) assert.equal(await statusOf(m, x), "stale");
    for (const x of ["f2", "b2"]) assert.equal(await statusOf(m, x), "valid");
    const stale = await m.getNode("d1");
    assert.equal(stale.stale_root, "f1");
    assert.equal(stale.stale_reason, "changed");
    assert.equal(stale.stale_depth, 2);
    await checkInvariants(m);
  });

  it("inherits the old source unless a new one is given", async () => {
    const m = await fresh("sup");
    await chain(m);
    await m.addSource({ id: "s2", name: "second" });
    const a = await m.supersede("f1", { content: "v2" });
    assert.deepEqual((await m.why(a.node.id)).sources.map((s) => s.id), ["s"]);
    const b = await m.supersede("f2", { content: "v2", sourceId: "s2" });
    assert.deepEqual((await m.why(b.node.id)).sources.map((s) => s.id), ["s2"]);
    await rejectsWith(m.supersede(a.node.id, { content: "x", sourceId: "ghost" }), 404);
  });

  it("works on leaf nodes (nothing to cascade)", async () => {
    const m = await fresh("sup");
    await chain(m);
    const leaf = await m.supersede("b2", { content: "b2 v2" });
    assert.deepEqual(leaf.impacted, []);
    const r = await m.supersede("f2", { content: "f2 v2" });
    assert.deepEqual(ids(r.impacted), [leaf.node.id], "the new b2 version hangs off f2 too");
  });

  it("superseding a derived node keeps its dependencies and stales its dependents", async () => {
    const m = await fresh("sup");
    await chain(m);
    const r = await m.supersede("b1", { content: "b1 revised" });
    assert.deepEqual(ids(r.impacted), ["a1", "d1"]);
    const why = await m.why(r.node.id);
    assert.deepEqual(why.ancestors.map((a) => a.id), ["f1"], "new version still hangs off f1");
    assert.equal(await statusOf(m, "f1"), "valid");
    await checkInvariants(m);
  });

  it("kind and meta carry over to the new version", async () => {
    const m = await fresh("sup");
    await withFacts(m);
    await m.addNode({ id: "f", kind: "fact", content: "v1", sourceId: "s", meta: { unit: "usd" } });
    const r = await m.supersede("f", { content: "v2" });
    assert.equal(r.node.kind, "fact");
    assert.deepEqual(r.node.meta, { unit: "usd" });
    assert.equal(r.node.confidence, 1);
    const c = await m.supersede(r.node.id, { content: "v3", confidence: 0.4 });
    assert.equal(c.node.confidence, 0.4);
  });

  it("refuses to supersede an already superseded or a stale node, and unknown ids", async () => {
    const m = await fresh("sup");
    await chain(m);
    await m.supersede("f1", { content: "v2" });
    await rejectsWith(m.supersede("f1", { content: "again" }), 409, /superseded/);
    await rejectsWith(m.supersede("b1", { content: "while stale" }), 409, /stale/);
    await rejectsWith(m.supersede("ghost", { content: "x" }), 404);
    assert.equal((await checkInvariants(m)).nodes.length, 7);
  });

  it("supports long supersede chains v1 -> v2 -> v3 -> v4", async () => {
    const m = await fresh("sup");
    await chain(m);
    let cur = "f1";
    for (let i = 2; i <= 4; i++) cur = (await m.supersede(cur, { content: `v${i}` })).node.id;
    const snap = await checkInvariants(m);
    assert.equal(snap.nodes.filter((n) => n.status === "superseded").length, 3);
    assert.equal(snap.edges.filter((e) => e.type === "SUPERSEDES").length, 3);
    // dependents were staled by the first change and stay stale; repair rebases to the LATEST version
    const r = await m.resolve("b1");
    assert.deepEqual(r.rebased, [{ from: "f1", to: cur }]);
  });

  it("second change upstream does not overwrite the original stale root", async () => {
    const m = await fresh("sup");
    await chain(m);
    await m.supersede("f1", { content: "v2" });
    await m.supersede("f2", { content: "f2 v2" });
    assert.equal((await m.getNode("d1")).stale_root, "f1");
    assert.equal(await statusOf(m, "b2"), "stale");
  });

  it("a node depending on two changed facts is staled once and fixed once both are repaired", async () => {
    const m = await fresh("sup");
    await withFacts(m, "p", "q");
    await m.addNode({ id: "j", kind: "belief", content: "join", dependsOn: ["p", "q"] });
    await m.supersede("p", { content: "p2" });
    await m.supersede("q", { content: "q2" });
    const r = await m.resolve("j");
    assert.equal(r.rebased.length, 2);
    await checkInvariants(m);
    assert.equal(await statusOf(m, "j"), "valid");
  });
});

describe("graph shapes", () => {
  it("diamond: each node staled once, correct depths", async () => {
    const m = await fresh("shape");
    await withFacts(m, "top");
    await m.addNode({ id: "l", kind: "belief", content: "l", dependsOn: ["top"] });
    await m.addNode({ id: "r", kind: "belief", content: "r", dependsOn: ["top"] });
    await m.addNode({ id: "bot", kind: "decision", content: "bot", dependsOn: ["l", "r"] });
    const out = await m.supersede("top", { content: "top2" });
    assert.deepEqual(out.impacted.map((i) => [i.id, i.depth]).sort(), [["bot", 2], ["l", 1], ["r", 1]]);
  });

  it("a 300-step chain cascades and repairs in order", async () => {
    const m = await fresh("shape");
    await withFacts(m, "n0");
    for (let i = 1; i <= 300; i++) {
      await m.addNode({ id: `n${i}`, kind: "belief", content: `n${i}`, dependsOn: [`n${i - 1}`] });
    }
    const out = await m.supersede("n0", { content: "n0 v2" });
    assert.equal(out.impacted.length, 300);
    assert.equal(out.impacted.at(-1)!.depth, 300);
    const plan = await m.repairPlan();
    assert.equal(plan.layers.length, 300);
    assert.equal(plan.layers[0].nodes[0].id, "n1");
  });

  it("a ladder of 40 diamonds (2^40 paths) is handled without path blow-up", async () => {
    const m = await fresh("shape");
    await withFacts(m, "t0");
    for (let i = 0; i < 40; i++) {
      await m.addNode({ id: `l${i}`, kind: "belief", content: "l", dependsOn: [`t${i}`] });
      await m.addNode({ id: `r${i}`, kind: "belief", content: "r", dependsOn: [`t${i}`] });
      await m.addNode({ id: `t${i + 1}`, kind: "belief", content: "t", dependsOn: [`l${i}`, `r${i}`] });
    }
    await m.addNode({ id: "act", kind: "action", content: "go", dependsOn: ["t40"] });
    const started = Date.now();
    assert.equal((await m.impact("t0")).length, 121);
    assert.equal((await m.checkAction("act")).allowed, true);
    const out = await m.supersede("t0", { content: "t0 v2" });
    assert.equal(out.impacted.length, 121);
    assert.equal((await m.checkAction("act")).stale, true);
    assert.equal((await m.why("act")).ancestors.length, 121);
    assert.ok(Date.now() - started < 20_000, "took too long");
  });

  it("wide fan-out: one fact, 150 dependents", async () => {
    const m = await fresh("shape");
    await withFacts(m, "hub");
    for (let i = 0; i < 150; i++) {
      await m.addNode({ id: `leaf${i}`, kind: "belief", content: "x", dependsOn: ["hub"] });
    }
    const out = await m.supersede("hub", { content: "hub2" });
    assert.equal(out.impacted.length, 150);
    assert.equal((await m.repairPlan()).layers[0].nodes.length, 150);
  });
});

describe("repair plan and resolve", () => {
  it("plan is empty on a healthy graph", async () => {
    const m = await fresh("rep");
    await chain(m);
    assert.deepEqual(await m.repairPlan(), { total: 0, executedActionsAtRisk: 0, layers: [] });
  });

  it("layers are root-first and carry rebase suggestions", async () => {
    const m = await fresh("rep");
    await chain(m);
    const v2 = (await m.supersede("f1", { content: "f1 v2" })).node.id;
    const plan = await m.repairPlan();
    assert.deepEqual(plan.layers.map((l) => l.nodes.map((n) => n.id)), [["b1"], ["d1"], ["a1"]]);
    assert.equal(plan.layers[0].nodes[0].rebase[0].to, v2);
    assert.deepEqual(plan.layers[1].nodes[0].rebase, []);
  });

  it("resolve is blocked until parents are repaired (409 lists blockers)", async () => {
    const m = await fresh("rep");
    await chain(m);
    await m.supersede("f1", { content: "v2" });
    await assert.rejects(m.resolve("d1"), (e: any) => {
      assert.equal(e.status, 409);
      assert.equal(e.details.blockers[0].id, "b1");
      return true;
    });
    assert.equal(await statusOf(m, "d1"), "stale");
  });

  it("full repair returns the graph to all-valid with the new content", async () => {
    const m = await fresh("rep");
    await chain(m);
    await m.supersede("f1", { content: "v2" });
    await m.resolve("b1", { content: "b1 recomputed", note: "checked" });
    await m.resolve("d1");
    await m.resolve("a1");
    const snap = await checkInvariants(m);
    assert.equal(snap.stats.stale, 0);
    assert.equal((await m.getNode("b1")).content, "b1 recomputed");
    const healed = await m.getNode("a1");
    assert.equal(healed.stale_root, undefined);
    assert.equal(healed.stale_reason, undefined);
    assert.equal(healed.stale_depth, undefined);
    assert.equal(healed.gate, "allowed");
  });

  it("resolve rejects valid, superseded and unknown nodes", async () => {
    const m = await fresh("rep");
    await chain(m);
    await rejectsWith(m.resolve("b1"), 409, /already valid/);
    await rejectsWith(m.resolve("ghost"), 404);
    await m.supersede("f1", { content: "v2" });
    await rejectsWith(m.resolve("f1"), 409, /superseded/);
  });

  it("a repaired node can be superseded again and re-stales its dependents", async () => {
    const m = await fresh("rep");
    await chain(m);
    await m.supersede("f1", { content: "v2" });
    await m.resolve("b1");
    await m.resolve("d1");
    await m.resolve("a1");
    const r = await m.supersede("b1", { content: "b1 again" });
    assert.deepEqual(ids(r.impacted), ["a1", "d1"]);
    await checkInvariants(m);
  });

  it("an already-executed action shows up as at-risk and stays executed through repair", async () => {
    const m = await fresh("rep");
    await chain(m);
    await m.executeAction("a1");
    const r = await m.supersede("f1", { content: "v2" });
    assert.deepEqual(r.executedActionsAtRisk.map((a) => a.id), ["a1"]);
    assert.equal((await m.repairPlan()).executedActionsAtRisk, 1);
    await m.resolve("b1");
    await m.resolve("d1");
    await m.resolve("a1");
    assert.ok((await m.getNode("a1")).executed_at, "history is not rewritten");
  });
});

describe("why", () => {
  it("returns ancestors, sources, edges and a verdict", async () => {
    const m = await fresh("why");
    await chain(m);
    const w = await m.why("a1");
    assert.deepEqual(ids(w.ancestors), ["b1", "d1", "f1"]);
    assert.deepEqual(w.sources.map((s) => s.id), ["s"]);
    assert.equal(w.edges.length, 4);
    assert.equal(w.verdict.allowed, true);
    assert.equal(w.node.id, "a1");
  });

  it("a fact explains itself with no ancestors; unknown is 404", async () => {
    const m = await fresh("why");
    await chain(m);
    const w = await m.why("f1");
    assert.deepEqual(w.ancestors, []);
    assert.deepEqual(w.sources.map((s) => s.id), ["s"]);
    await rejectsWith(m.why("ghost"), 404);
  });

  it("reflects staleness in the verdict", async () => {
    const m = await fresh("why");
    await chain(m);
    await m.supersede("f1", { content: "v2" });
    const w = await m.why("a1");
    assert.equal(w.verdict.stale, true);
    assert.equal(w.verdict.allowed, false);
  });
});
