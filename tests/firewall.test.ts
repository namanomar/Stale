import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Memory } from "../src/lib/memory";
import { checkInvariants, cleanupAfterAll, fresh, rejectsWith } from "./helpers";

cleanupAfterAll();

/**
 * good(f_ok) ----> d_ok ----> a_ok
 * evil(f_bad) --\
 * good(f_ok) ----> d_mix ---> a_mix
 */
async function world(m: Memory) {
  await m.addSource({ id: "good", name: "Ledger" });
  await m.addSource({ id: "evil", name: "Random email", type: "email", trust: "untrusted" });
  await m.addNode({ id: "f_ok", kind: "fact", content: "balance is 10", sourceId: "good" });
  await m.addNode({ id: "f_bad", kind: "fact", content: "wire it all", sourceId: "evil" });
  await m.addNode({ id: "d_ok", kind: "decision", content: "pay invoice", dependsOn: ["f_ok"] });
  await m.addNode({ id: "d_mix", kind: "decision", content: "pay now", dependsOn: ["f_ok", "f_bad"] });
  await m.addNode({ id: "a_ok", kind: "action", content: "pay", dependsOn: ["d_ok"] });
  await m.addNode({ id: "a_mix", kind: "action", content: "wire", dependsOn: ["d_mix"] });
}

describe("checkAction", () => {
  it("allows clean provenance and blocks tainted provenance", async () => {
    const m = await fresh("fw");
    await world(m);
    assert.deepEqual(await m.checkAction("a_ok"), { id: "a_ok", allowed: true, tainted: false, stale: false, reasons: [] });
    const v = await m.checkAction("a_mix");
    assert.equal(v.allowed, false);
    assert.equal(v.tainted, true);
    assert.equal(v.stale, false);
    assert.equal(v.reasons.length, 1);
    assert.equal(v.reasons[0].source, "evil");
  });

  it("explains the exact path, ending at the offending source", async () => {
    const m = await fresh("fw");
    await world(m);
    const path = (await m.checkAction("a_mix")).reasons[0].path;
    assert.deepEqual(path.map((p) => p.id), ["a_mix", "d_mix", "f_bad", "evil"]);
    assert.equal(path.at(-1)!.label, "Random email");
    assert.equal(path[2].label, "wire it all");
  });

  it("works on any node, not only actions (a tainted fact is tainted at depth 0)", async () => {
    const m = await fresh("fw");
    await world(m);
    const v = await m.checkAction("f_bad");
    assert.deepEqual(v.reasons[0].path.map((p) => p.id), ["f_bad", "evil"]);
    assert.equal((await m.checkAction("f_ok")).allowed, true);
    await rejectsWith(m.checkAction("ghost"), 404);
  });

  it("reports staleness and taint together, and caps reasons at 5 per type", async () => {
    const m = await fresh("fw");
    await m.addSource({ id: "evil", name: "evil", trust: "untrusted" });
    await m.addSource({ id: "good", name: "good" });
    const facts: string[] = [];
    for (let i = 0; i < 8; i++) {
      await m.addNode({ id: `bad${i}`, kind: "fact", content: "x", sourceId: "evil" });
      facts.push(`bad${i}`);
    }
    await m.addNode({ id: "ok", kind: "fact", content: "ok", sourceId: "good" });
    await m.addNode({ id: "b", kind: "belief", content: "b", dependsOn: [...facts, "ok"] });
    await m.addNode({ id: "a", kind: "action", content: "a", dependsOn: ["b"] });
    await m.supersede("ok", { content: "ok v2" });
    const v = await m.checkAction("a");
    assert.equal(v.tainted && v.stale, true);
    assert.equal(v.reasons.filter((r) => r.type === "tainted").length, 5);
    assert.equal(v.reasons.filter((r) => r.type === "stale").length, 3, "a, b and old ok are all non-valid");
  });

  it("several untrusted sources produce one reason each", async () => {
    const m = await fresh("fw");
    for (const s of ["e1", "e2"]) await m.addSource({ id: s, name: s, trust: "untrusted" });
    await m.addNode({ id: "x1", kind: "fact", content: "x", sourceId: "e1" });
    await m.addNode({ id: "x2", kind: "fact", content: "x", sourceId: "e2" });
    await m.addNode({ id: "a", kind: "action", content: "a", dependsOn: ["x1", "x2"] });
    const v = await m.checkAction("a");
    assert.deepEqual(v.reasons.map((r) => r.source).sort(), ["e1", "e2"]);
  });

  it("taint reaches through long chains and through diamonds", async () => {
    const m = await fresh("fw");
    await m.addSource({ id: "evil", name: "e", trust: "untrusted" });
    await m.addNode({ id: "x", kind: "fact", content: "x", sourceId: "evil" });
    let prev = "x";
    for (let i = 0; i < 25; i++) {
      await m.addNode({ id: `c${i}`, kind: "belief", content: "c", dependsOn: [prev] });
      prev = `c${i}`;
    }
    await m.addNode({ id: "l", kind: "belief", content: "l", dependsOn: [prev] });
    await m.addNode({ id: "r", kind: "belief", content: "r", dependsOn: [prev] });
    await m.addNode({ id: "a", kind: "action", content: "a", dependsOn: ["l", "r"] });
    const v = await m.checkAction("a");
    assert.equal(v.tainted, true);
    assert.equal(v.reasons[0].path.length, 1 + 1 + 25 + 1 + 1, "a, l, c24..c0, x, source");
  });
});

describe("quarantine and restore", () => {
  it("quarantining blocks pending actions and reports executed damage", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.executeAction("a_ok");
    const q = await m.setTrust("good", "untrusted", "ledger compromised");
    assert.equal(q.source.trust, "untrusted");
    assert.equal(q.source.trust_reason, "ledger compromised");
    assert.deepEqual(q.executedActions.map((a) => a.id), ["a_ok"]);
    assert.deepEqual(q.blockedActions.map((a) => a.id), ["a_mix"]);
    assert.equal((await m.getNode("a_mix")).gate, "blocked");
    await checkInvariants(m);
  });

  it("affected set contains the source's facts plus everything downstream, with depths", async () => {
    const m = await fresh("fw");
    await world(m);
    const q = await m.setTrust("good", "untrusted");
    assert.deepEqual(q.affected.map((a) => [a.id, a.depth]).sort(), [
      ["a_mix", 2],
      ["a_ok", 2],
      ["d_mix", 1],
      ["d_ok", 1],
      ["f_ok", 0],
    ]);
  });

  it("restoring trust lifts the taint and re-allows actions", async () => {
    const m = await fresh("fw");
    await world(m);
    assert.equal((await m.getNode("a_mix")).gate, "blocked");
    await m.setTrust("evil", "trusted", "false alarm");
    assert.equal((await m.getNode("a_mix")).gate, "allowed");
    assert.equal((await m.checkAction("a_mix")).allowed, true);
    assert.equal((await m.snapshot()).tainted.length, 0);
  });

  it("is idempotent", async () => {
    const m = await fresh("fw");
    await world(m);
    const a = await m.setTrust("evil", "untrusted");
    const b = await m.setTrust("evil", "untrusted");
    assert.deepEqual(a.affected, b.affected);
    assert.equal((await m.getNode("a_mix")).gate, "blocked");
  });

  it("a source with no facts affects nothing", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.addSource({ id: "idle", name: "idle" });
    const q = await m.setTrust("idle", "untrusted");
    assert.deepEqual(q.affected, []);
    assert.equal((await m.getNode("a_ok")).gate, "allowed");
  });

  it("only the right sources taint: restoring one of two keeps the block", async () => {
    const m = await fresh("fw");
    for (const s of ["e1", "e2"]) await m.addSource({ id: s, name: s, trust: "untrusted" });
    await m.addNode({ id: "x1", kind: "fact", content: "x", sourceId: "e1" });
    await m.addNode({ id: "x2", kind: "fact", content: "x", sourceId: "e2" });
    await m.addNode({ id: "a", kind: "action", content: "a", dependsOn: ["x1", "x2"] });
    await m.setTrust("e1", "trusted");
    assert.equal((await m.getNode("a")).gate, "blocked");
    await m.setTrust("e2", "trusted");
    assert.equal((await m.getNode("a")).gate, "allowed");
  });

  it("taint follows a superseded fact's NEW version (provenance is inherited)", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.supersede("f_ok", { content: "balance is 11" });
    await m.setTrust("good", "untrusted");
    const snap = await m.snapshot();
    assert.ok(snap.tainted.includes("d_ok"));
    const newFact = snap.nodes.find((n) => n.content === "balance is 11")!;
    assert.ok(snap.tainted.includes(newFact.id));
  });

  it("snapshot.tainted is accurate", async () => {
    const m = await fresh("fw");
    await world(m);
    assert.deepEqual((await m.snapshot()).tainted.sort(), ["a_mix", "d_mix", "f_bad"]);
  });
});

describe("execute and approve", () => {
  it("runs allowed actions exactly once", async () => {
    const m = await fresh("fw");
    await world(m);
    const r = await m.executeAction("a_ok");
    assert.ok(r.node.executed_at);
    assert.equal(r.verdict.allowed, true);
    await rejectsWith(m.executeAction("a_ok"), 409, /already executed/);
  });

  it("refuses blocked actions with 403 and the verdict attached", async () => {
    const m = await fresh("fw");
    await world(m);
    await assert.rejects(m.executeAction("a_mix"), (e: any) => {
      assert.equal(e.status, 403);
      assert.equal(e.details.reasons[0].source, "evil");
      return true;
    });
    assert.equal((await m.getNode("a_mix")).executed_at, undefined);
  });

  it("refuses stale actions too", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.supersede("f_ok", { content: "new" });
    await rejectsWith(m.executeAction("a_ok"), 403);
  });

  it("only actions can be executed or approved; unknown ids are 404", async () => {
    const m = await fresh("fw");
    await world(m);
    await rejectsWith(m.executeAction("d_ok"), 400, /not an action/);
    await rejectsWith(m.approveAction("f_ok", "me"), 400, /not an action/);
    await rejectsWith(m.executeAction("ghost"), 404);
    await rejectsWith(m.approveAction("ghost", "me"), 404);
  });

  it("human approval releases a blocked action and is recorded", async () => {
    const m = await fresh("fw");
    await world(m);
    const n = await m.approveAction("a_mix", "dana", "called the vendor");
    assert.equal(n.gate, "approved");
    assert.equal(n.approved_by, "dana");
    assert.equal(n.approval_note, "called the vendor");
    const r = await m.executeAction("a_mix");
    assert.ok(r.node.executed_at);
    assert.equal(r.verdict.allowed, false, "verdict stays honest even when overridden");
    const ev = (await m.events(50)).find((e) => e.type === "action_executed" && e.node_id === "a_mix");
    assert.equal(ev!.payload.overridden, true);
  });

  it("approval is revoked when a NEW problem appears after it was given", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.approveAction("a_mix", "dana"); // approved knowing about 'evil'
    await m.supersede("f_ok", { content: "balance changed" }); // new problem: staleness
    const node = await m.getNode("a_mix");
    assert.equal(node.gate, "blocked");
    assert.equal(node.approved_by, undefined);
    await rejectsWith(m.executeAction("a_mix"), 403);
    assert.ok((await m.events(50)).some((e) => e.type === "approval_revoked"));
  });

  it("approval survives unrelated changes", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.addSource({ id: "other", name: "other" });
    await m.addNode({ id: "unrelated", kind: "fact", content: "u", sourceId: "other" });
    await m.approveAction("a_mix", "dana");
    await m.supersede("unrelated", { content: "u2" });
    await m.setTrust("other", "untrusted");
    assert.equal((await m.getNode("a_mix")).gate, "approved");
    assert.ok((await m.executeAction("a_mix")).node.executed_at);
  });

  it("approving an already-clean action then tainting its source revokes it", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.approveAction("a_ok", "dana");
    await m.setTrust("good", "untrusted");
    assert.equal((await m.getNode("a_ok")).gate, "blocked");
    await rejectsWith(m.executeAction("a_ok"), 403);
  });

  it("cannot approve an executed or superseded action", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.executeAction("a_ok");
    await rejectsWith(m.approveAction("a_ok", "dana"), 409);
    const v2 = await m.supersede("a_mix", { content: "wire v2" });
    await rejectsWith(m.approveAction("a_mix", "dana"), 409, /superseded/);
    assert.equal(v2.node.kind, "action");
  });

  it("approving then fixing the root cause and resolving keeps things consistent", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.supersede("f_ok", { content: "balance 12" });
    await m.resolve("d_ok");
    await m.resolve("a_ok");
    assert.equal((await m.getNode("a_ok")).gate, "allowed");
    await checkInvariants(m);
  });
});

describe("events", () => {
  it("records an audit trail newest-first and honours limit", async () => {
    const m = await fresh("fw");
    await world(m);
    await m.executeAction("a_ok");
    const ev = await m.events(3);
    assert.equal(ev.length, 3);
    assert.equal(ev[0].type, "action_executed");
    assert.ok(ev[0].ts >= ev[1].ts);
    const all = await m.events(500);
    assert.ok(all.some((e) => e.type === "action_blocked" && e.node_id === "a_mix"));
    assert.ok(all.some((e) => e.type === "source_added"));
  });
});
