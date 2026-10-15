import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkInvariants, cleanupAfterAll, fresh, rejectsWith, withFacts } from "./helpers";

cleanupAfterAll();

describe("sources", () => {
  it("creates, reads and lists sources with defaults", async () => {
    const m = await fresh("src");
    const s = await m.addSource({ id: "a", name: "A" });
    assert.equal(s.trust, "trusted");
    assert.equal(s.type, "unknown");
    assert.deepEqual(await m.getSource("a"), s);
    await m.addSource({ id: "b", name: "B", type: "email", trust: "untrusted" });
    assert.deepEqual((await m.listSources()).map((x) => x.id), ["a", "b"]);
  });

  it("generates an id when none is given", async () => {
    const m = await fresh("src");
    const s = await m.addSource({ name: "anon" });
    assert.match(s.id, /^s_[0-9a-f]{8}$/);
  });

  it("rejects duplicate ids with 409 and unknown ids with 404", async () => {
    const m = await fresh("src");
    await m.addSource({ id: "a", name: "A" });
    await rejectsWith(m.addSource({ id: "a", name: "again" }), 409);
    await rejectsWith(m.getSource("nope"), 404);
    await rejectsWith(m.setTrust("nope", "untrusted"), 404);
    assert.equal((await m.listSources()).length, 1);
  });

  it("stores awkward names verbatim (quotes, unicode, newlines, cypher fragments)", async () => {
    const m = await fresh("src");
    const name = `O'Brien "Q" \\ ünï 日本語 🚀\n'}) DETACH DELETE n //`;
    await m.addSource({ id: "weird", name });
    assert.equal((await m.getSource("weird")).name, name);
  });
});

describe("adding nodes", () => {
  it("stores a fact with provenance and defaults", async () => {
    const m = await fresh("n");
    await m.addSource({ id: "s", name: "S" });
    const { node, gate } = await m.addNode({ id: "f1", kind: "fact", content: "sky is blue", sourceId: "s" });
    assert.equal(node.status, "valid");
    assert.equal(node.confidence, 1);
    assert.equal(gate, undefined);
    assert.deepEqual(node.meta, {});
    const snap = await checkInvariants(m);
    assert.deepEqual(snap.edges, [{ from: "f1", to: "s", type: "FROM" }]);
  });

  it("round-trips meta and confidence (including 0)", async () => {
    const m = await fresh("n");
    await withFacts(m);
    const { node } = await m.addNode({
      kind: "fact",
      content: "c",
      sourceId: "s",
      confidence: 0,
      meta: { a: 1, nested: { b: [1, 2, 3] }, s: "x'y" },
    });
    assert.equal(node.confidence, 0);
    assert.deepEqual(node.meta, { a: 1, nested: { b: [1, 2, 3] }, s: "x'y" });
  });

  it("generates kind-prefixed ids", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1");
    const b = (await m.addNode({ kind: "belief", content: "b", dependsOn: ["f1"] })).node;
    const d = (await m.addNode({ kind: "decision", content: "d", dependsOn: [b.id] })).node;
    const a = (await m.addNode({ kind: "action", content: "a", dependsOn: [d.id] })).node;
    assert.match(b.id, /^b_/);
    assert.match(d.id, /^d_/);
    assert.match(a.id, /^a_/);
  });

  it("requires a source for facts and dependencies for everything else", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1");
    await rejectsWith(m.addNode({ kind: "fact", content: "orphan" }), 400, /sourceId/);
    for (const kind of ["belief", "decision", "action"] as const) {
      await rejectsWith(m.addNode({ kind, content: "x" }), 400, /depend/);
      await rejectsWith(m.addNode({ kind, content: "x", dependsOn: [] }), 400, /depend/);
    }
  });

  it("404s on unknown source or unknown dependency and leaves no partial node", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1");
    await rejectsWith(m.addNode({ id: "x", kind: "fact", content: "c", sourceId: "ghost" }), 404);
    await rejectsWith(m.addNode({ id: "y", kind: "belief", content: "c", dependsOn: ["f1", "ghost"] }), 404);
    await rejectsWith(m.getNode("x"), 404);
    await rejectsWith(m.getNode("y"), 404);
    assert.equal((await checkInvariants(m)).nodes.length, 1);
  });

  it("rejects duplicate ids and keeps the original untouched", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1");
    await rejectsWith(m.addNode({ id: "f1", kind: "fact", content: "other", sourceId: "s" }), 409);
    assert.equal((await m.getNode("f1")).content, "fact f1");
  });

  it("deduplicates repeated dependencies into a single edge", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1");
    await m.addNode({ id: "b", kind: "belief", content: "b", dependsOn: ["f1", "f1", "f1"] });
    const deps = (await m.snapshot()).edges.filter((e) => e.type === "DEPENDS_ON");
    assert.equal(deps.length, 1);
  });

  it("a derived node may also cite a source directly", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1");
    await m.addSource({ id: "s2", name: "second" });
    await m.addNode({ id: "b", kind: "belief", content: "b", dependsOn: ["f1"], sourceId: "s2" });
    const why = await m.why("b");
    assert.deepEqual(why.sources.map((s) => s.id).sort(), ["s", "s2"]);
  });

  it("a fact may derive from other facts", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1");
    await m.addNode({ id: "f2", kind: "fact", content: "derived fact", dependsOn: ["f1"] });
    await checkInvariants(m);
  });

  it("stores boundary and hostile content verbatim", async () => {
    const m = await fresh("n");
    await withFacts(m);
    const samples = [
      "x",
      "a".repeat(4000),
      "line1\nline2\r\n\ttabbed",
      `quote ' double " backslash \\ backtick \``,
      "'}) MATCH (n) DETACH DELETE n //",
      "日本語 🚀 ñ é ü 𝔘𝔫𝔦𝔠𝔬𝔡𝔢",
      "$param {braces} [brackets] (parens) ;semi",
      " leading and trailing ",
    ];
    for (const [i, content] of samples.entries()) {
      const { node } = await m.addNode({ id: `h${i}`, kind: "fact", content, sourceId: "s" });
      assert.equal(node.content, content);
      assert.equal((await m.getNode(`h${i}`)).content, content);
    }
    assert.equal((await checkInvariants(m)).nodes.length, samples.length, "injection deleted nothing");
  });

  it("cannot build on stale or superseded nodes (all blockers listed)", async () => {
    const m = await fresh("n");
    await withFacts(m, "f1", "f2");
    await m.addNode({ id: "b1", kind: "belief", content: "b1", dependsOn: ["f1"] });
    await m.supersede("f1", { content: "f1 v2" });
    await rejectsWith(m.addNode({ kind: "belief", content: "x", dependsOn: ["b1"] }), 409, /stale/);
    await assert.rejects(m.addNode({ kind: "belief", content: "x", dependsOn: ["f1", "b1", "f2"] }), (e: any) => {
      assert.deepEqual(e.details.blockers.map((b: any) => [b.id, b.status]).sort(), [
        ["b1", "stale"],
        ["f1", "superseded"],
      ]);
      return true;
    });
    assert.equal((await checkInvariants(m)).nodes.length, 4);
  });

  it("getNode on a missing id is 404", async () => {
    const m = await fresh("n");
    await rejectsWith(m.getNode("missing"), 404);
  });
});

describe("actions at creation", () => {
  it("clean actions are allowed, tainted ones blocked on arrival", async () => {
    const m = await fresh("a");
    await m.addSource({ id: "good", name: "good" });
    await m.addSource({ id: "bad", name: "bad", trust: "untrusted" });
    await m.addNode({ id: "fg", kind: "fact", content: "g", sourceId: "good" });
    await m.addNode({ id: "fb", kind: "fact", content: "b", sourceId: "bad" });
    const ok = await m.addNode({ id: "a1", kind: "action", content: "do", dependsOn: ["fg"] });
    const no = await m.addNode({ id: "a2", kind: "action", content: "do", dependsOn: ["fg", "fb"] });
    assert.equal(ok.gate!.allowed, true);
    assert.equal(ok.node.gate, "allowed");
    assert.equal(no.gate!.allowed, false);
    assert.equal(no.node.gate, "blocked");
    await checkInvariants(m);
  });

  it("actions can be the dependency of other actions (follow-ups)", async () => {
    const m = await fresh("a");
    await withFacts(m, "f1");
    await m.addNode({ id: "a1", kind: "action", content: "first", dependsOn: ["f1"] });
    await m.addNode({ id: "a2", kind: "action", content: "second", dependsOn: ["a1"] });
    await m.supersede("f1", { content: "f1 v2" });
    assert.equal((await m.checkAction("a2")).allowed, false);
  });
});
