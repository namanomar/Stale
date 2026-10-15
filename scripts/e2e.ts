/* End-to-end check of the memory engine against a live FalkorDB. Run: npm test */
import assert from "node:assert/strict";
import { seedDemo } from "../src/lib/demo";
import { Memory } from "../src/lib/memory";
import { StaleError } from "../src/lib/errors";

const T = "e2e_" + Date.now().toString(36);
const step = (s: string) => console.log("\n==", s);

async function main() {
  const m0 = await Memory.open(T);
  await m0.reset();
  const mem = await Memory.open(T);

  step("seed");
  const snap = await seedDemo(mem);
  console.log(snap.stats);
  assert.equal(snap.stats.stale, 0);
  assert.equal(snap.stats.executedActions, 1);
  assert.equal(snap.stats.blockedActions, 1, "a_wire should be blocked on creation");

  step("impact of f_price (dry run)");
  const dry = await mem.impact("f_price");
  console.log(dry.map((d) => `${d.depth}:${d.id}`).join(" "));
  assert.deepEqual(
    dry.map((d) => d.id).sort(),
    ["a_ads", "a_po", "a_press", "b_cost", "b_margin", "d_marketing", "d_vendor"].sort(),
  );
  assert.equal(dry.find((d) => d.id === "b_cost")!.depth, 1);
  assert.equal(dry.find((d) => d.id === "a_po")!.depth, 3);

  step("supersede f_price -> cascade");
  const sup = await mem.supersede("f_price", {
    content: "Acme now quotes $140/unit for 1,000 units",
    reason: "vendor raised price 40%",
  });
  console.log(sup.impacted.map((i) => `${i.depth}:${i.id}`).join(" "));
  assert.equal(sup.impacted.length, 7);
  assert.deepEqual(sup.executedActionsAtRisk.map((a) => a.id), ["a_po"]);
  assert.equal((await mem.getNode("f_date")).status, "valid", "unrelated facts stay valid");
  assert.equal((await mem.getNode("a_press")).status, "stale");
  assert.equal((await mem.getNode("a_press")).gate, "blocked");

  step("cannot build on stale nodes");
  await assert.rejects(
    mem.addNode({ kind: "belief", content: "x", dependsOn: ["b_cost"] }),
    (e: unknown) => e instanceof StaleError && e.status === 409,
  );

  step("repair root-first");
  const plan = await mem.repairPlan();
  console.log(plan.layers.map((l) => `L${l.layer}: ${l.nodes.map((n) => n.id).join(",")}`));
  assert.equal(plan.total, 7);
  assert.equal(plan.layers[0].nodes[0].id, "b_cost");
  await assert.rejects(mem.resolve("b_margin"), (e: unknown) => e instanceof StaleError && e.status === 409);
  const r1 = await mem.resolve("b_cost", { content: "Hardware will cost about $140,000" });
  assert.equal(r1.rebased.length, 1);
  await mem.resolve("b_margin", { content: "Only $10k to spare" });
  await mem.resolve("d_vendor");
  await mem.resolve("d_marketing", { content: "Spend $20k on marketing" });
  await mem.resolve("a_press");
  await mem.resolve("a_ads");
  await mem.resolve("a_po");
  const after = await mem.snapshot();
  console.log(after.stats);
  assert.equal(after.stats.stale, 0);

  step("why a_po");
  const why = await mem.why("a_po");
  console.log(why.ancestors.map((a) => a.id).join(" "), "| sources:", why.sources.map((s) => s.id).join(","));
  assert.ok(why.ancestors.some((a) => a.status === "valid"));
  assert.ok(why.sources.some((s) => s.id === "s_vendor"));

  step("firewall: tainted wire");
  const v = await mem.checkAction("a_wire");
  console.log(JSON.stringify(v.reasons[0]));
  assert.equal(v.allowed, false);
  assert.equal(v.tainted, true);
  assert.deepEqual(v.reasons[0].path.map((p) => p.id), ["a_wire", "d_pay", "f_inject", "s_ext_email"]);
  await assert.rejects(mem.executeAction("a_wire"), (e: unknown) => e instanceof StaleError && e.status === 403);
  assert.ok((await mem.snapshot()).tainted.includes("a_wire"));

  step("quarantine trusted source after the fact");
  const q = await mem.setTrust("s_vendor", "untrusted", "vendor account compromised");
  console.log(q.affected.map((a) => a.id).join(" "));
  assert.deepEqual(q.executedActions.map((a) => a.id), ["a_po"], "executed damage reported");
  assert.equal((await mem.getNode("a_ads")).gate, "blocked");
  await mem.setTrust("s_vendor", "trusted");
  assert.equal((await mem.getNode("a_ads")).gate, "allowed", "taint lifts when trust is restored");

  step("human approval overrides");
  await mem.approveAction("a_wire", "cfo@example.com", "verified by phone");
  const ex = await mem.executeAction("a_wire");
  assert.ok(ex.node.executed_at);

  step("tenant isolation");
  const other = await Memory.open(T + "_b");
  await other.reset();
  const other2 = await Memory.open(T + "_b");
  assert.equal((await other2.snapshot()).nodes.length, 0);

  step("events");
  console.log((await mem.events(5)).map((e) => e.type).join(" "));

  await mem.reset();
  await other2.reset();
  console.log("\nALL GOOD");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nFAILED:", e);
  process.exit(1);
});
