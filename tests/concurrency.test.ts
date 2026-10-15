import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkInvariants, cleanupAfterAll, fresh, withFacts } from "./helpers";

cleanupAfterAll();

describe("concurrency", () => {
  it("40 parallel inserts all land with no lost updates", async () => {
    const m = await fresh("cc");
    await withFacts(m);
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        m.addNode({ id: `f${i}`, kind: "fact", content: `fact ${i}`, sourceId: "s" }),
      ),
    );
    assert.equal((await checkInvariants(m)).nodes.length, 40);
  });

  it("racing inserts of the same id: exactly one wins", async () => {
    const m = await fresh("cc");
    await withFacts(m);
    const res = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        m.addNode({ id: "same", kind: "fact", content: `try ${i}`, sourceId: "s" }),
      ),
    );
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(res.filter((r) => r.status === "rejected").every((r: any) => r.reason.status === 409));
    assert.equal((await checkInvariants(m)).nodes.length, 1);
    const edges = (await m.snapshot()).edges.filter((e) => e.from === "same");
    assert.equal(edges.length, 1, "no duplicated provenance edges");
  });

  it("racing source registrations: exactly one wins", async () => {
    const m = await fresh("cc");
    const res = await Promise.allSettled(
      Array.from({ length: 10 }, () => m.addSource({ id: "dup", name: "x" })),
    );
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await m.listSources()).length, 1);
  });

  it("racing supersedes of one fact: exactly one version is created", async () => {
    const m = await fresh("cc");
    await withFacts(m, "f");
    await m.addNode({ id: "b", kind: "belief", content: "b", dependsOn: ["f"] });
    const res = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => m.supersede("f", { content: `v${i}` })),
    );
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
    const snap = await checkInvariants(m);
    assert.equal(snap.edges.filter((e) => e.type === "SUPERSEDES").length, 1);
    assert.equal(snap.nodes.filter((n) => n.status === "valid" && n.kind === "fact").length, 1);
  });

  it("adds racing a supersede never leave a valid node on a stale parent", async () => {
    const m = await fresh("cc");
    await withFacts(m, "f");
    await m.addNode({ id: "b0", kind: "belief", content: "b0", dependsOn: ["f"] });
    const adds = Array.from({ length: 15 }, (_, i) =>
      m.addNode({ id: `b${i + 1}`, kind: "belief", content: "x", dependsOn: ["f"] }).catch(() => null),
    );
    const sup = m.supersede("f", { content: "f2" });
    await Promise.all([...adds, sup]);
    // May be inconsistent only if the check-then-insert window was hit; report precisely.
    await checkInvariants(m);
  });

  it("parallel reads during writes are consistent", async () => {
    const m = await fresh("cc");
    await withFacts(m, "f");
    for (let i = 0; i < 10; i++) {
      await m.addNode({ id: `b${i}`, kind: "belief", content: "b", dependsOn: ["f"] });
    }
    const reads = Array.from({ length: 20 }, () => m.impact("f"));
    const write = m.supersede("f", { content: "f2" });
    const results = await Promise.all([...reads, write]);
    for (const r of results.slice(0, 20) as { id: string }[][]) assert.equal(r.length, 10);
  });

  it("two tenants written in parallel never see each other's data", async () => {
    const [a, b] = await Promise.all([fresh("cc_a"), fresh("cc_b")]);
    await Promise.all([withFacts(a, "x1", "x2"), withFacts(b, "y1")]);
    assert.deepEqual((await a.snapshot()).nodes.map((n) => n.id).sort(), ["x1", "x2"]);
    assert.deepEqual((await b.snapshot()).nodes.map((n) => n.id), ["y1"]);
  });
});
