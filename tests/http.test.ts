import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as health from "../src/app/api/v1/health/route";
import * as graph from "../src/app/api/v1/graph/route";
import * as sources from "../src/app/api/v1/sources/route";
import * as trust from "../src/app/api/v1/sources/[id]/trust/route";
import * as nodes from "../src/app/api/v1/nodes/route";
import * as node from "../src/app/api/v1/nodes/[id]/route";
import * as why from "../src/app/api/v1/nodes/[id]/why/route";
import * as impact from "../src/app/api/v1/nodes/[id]/impact/route";
import * as supersede from "../src/app/api/v1/nodes/[id]/supersede/route";
import * as resolve from "../src/app/api/v1/nodes/[id]/resolve/route";
import * as check from "../src/app/api/v1/actions/[id]/check/route";
import * as approve from "../src/app/api/v1/actions/[id]/approve/route";
import * as execute from "../src/app/api/v1/actions/[id]/execute/route";
import * as plan from "../src/app/api/v1/repair-plan/route";
import * as events from "../src/app/api/v1/events/route";
import * as seed from "../src/app/api/v1/demo/seed/route";
import * as tenantRoute from "../src/app/api/v1/tenant/route";
import * as tenants from "../src/app/api/v1/tenants/route";
import { normalizeTenant } from "../src/lib/db";
import { call, cleanupAfterAll, fresh } from "./helpers";

cleanupAfterAll();

const T = async (label = "http") => (await fresh(label)).tenant;

afterEach(() => {
  delete process.env.STALE_API_KEY;
});

describe("tenant resolution", () => {
  it("normalizeTenant defaults and validates", () => {
    assert.equal(normalizeTenant(undefined), "demo");
    assert.equal(normalizeTenant(null), "demo");
    assert.equal(normalizeTenant("  acme_1-x "), "acme_1-x");
    for (const bad of ["", "   ", "a b", "a/b", "../x", "x".repeat(49), "tenant;drop", "é", "a:b"]) {
      assert.throws(() => normalizeTenant(bad), /tenant must match/, JSON.stringify(bad));
    }
    assert.equal(normalizeTenant("x".repeat(48)).length, 48);
  });

  it("400 for a bad tenant on every kind of route", async () => {
    for (const h of [graph.GET, plan.GET, events.GET, sources.GET]) {
      const r = await call(h, { tenant: "bad tenant!" });
      assert.equal(r.status, 400);
      assert.match(r.json.error, /tenant/);
    }
    assert.equal((await call(graph.GET, { path: "/?tenant=a%2Fb" })).status, 400);
  });

  it("the header wins over the query string; query works alone", async () => {
    const a = await T("ta");
    const b = await T("tb");
    await call(sources.POST, { tenant: a, body: { id: "only_a", name: "A" } });
    const viaHeader = await call(sources.GET, { tenant: a, path: `/?tenant=${b}` });
    assert.equal(viaHeader.json.length, 1);
    const viaQuery = await call(sources.GET, { path: `/?tenant=${b}` });
    assert.equal(viaQuery.json.length, 0);
  });

  it("tenants are isolated and listed", async () => {
    const a = await T("iso_a");
    const b = await T("iso_b");
    await call(sources.POST, { tenant: a, body: { id: "x", name: "X" } });
    await call(sources.POST, { tenant: b, body: { id: "x", name: "X" } }); // same id, no clash
    const list = await call(tenants.GET);
    assert.ok(list.json.includes(a) && list.json.includes(b));
    assert.equal((await call(graph.GET, { tenant: a })).json.sources.length, 1);
  });
});

describe("health, seed, reset", () => {
  it("health reports connected", async () => {
    const r = await call(health.GET);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });

  it("seed loads the demo and is repeatable", async () => {
    const t = await T("seed");
    const a = await call(seed.POST, { tenant: t, method: "POST" });
    assert.equal(a.status, 200);
    assert.equal(a.json.stats.nodes, 14);
    assert.equal(a.json.stats.blockedActions, 1);
    const b = await call(seed.POST, { tenant: t, method: "POST" });
    assert.equal(b.status, 200, "re-seeding wipes first, no duplicate-id errors");
    assert.equal(b.json.stats.nodes, 14);
  });

  it("DELETE tenant empties it", async () => {
    const t = await T("reset");
    await call(seed.POST, { tenant: t, method: "POST" });
    const d = await call(tenantRoute.DELETE, { tenant: t, method: "DELETE" });
    assert.deepEqual(d.json, { reset: t });
    assert.equal((await call(graph.GET, { tenant: t })).json.nodes.length, 0);
    assert.equal((await call(tenantRoute.DELETE, { tenant: t, method: "DELETE" })).status, 200, "idempotent");
  });
});

describe("request validation", () => {
  it("rejects malformed JSON and wrong types with 400", async () => {
    const t = await T("val");
    assert.equal((await call(sources.POST, { tenant: t, rawBody: "{nope" })).status, 400);
    assert.equal((await call(sources.POST, { tenant: t, rawBody: "" })).status, 400, "empty body lacks 'name'");
    assert.equal((await call(sources.POST, { tenant: t, rawBody: "null" })).status, 400);
    assert.equal((await call(sources.POST, { tenant: t, rawBody: "[]" })).status, 400);
    assert.equal((await call(sources.POST, { tenant: t, body: { name: 5 } })).status, 400);
    assert.equal((await call(sources.POST, { tenant: t, body: { name: "" } })).status, 400);
    assert.equal((await call(sources.POST, { tenant: t, body: { name: "x", trust: "maybe" } })).status, 400);
    const r = await call(sources.POST, { tenant: t, body: { name: 5 } });
    assert.ok(Array.isArray(r.json.details), "zod issues are returned");
  });

  it("node payload bounds", async () => {
    const t = await T("val");
    await call(sources.POST, { tenant: t, body: { id: "s", name: "s" } });
    const base = { kind: "fact", content: "ok", sourceId: "s" };
    const post = (b: object) => call(nodes.POST, { tenant: t, body: b });
    assert.equal((await post({ ...base, content: "x".repeat(4000) })).status, 201);
    assert.equal((await post({ ...base, content: "x".repeat(4001) })).status, 400);
    assert.equal((await post({ ...base, content: "" })).status, 400);
    assert.equal((await post({ ...base, kind: "rumour" })).status, 400);
    assert.equal((await post({ ...base, confidence: 1.01 })).status, 400);
    assert.equal((await post({ ...base, confidence: -0.01 })).status, 400);
    assert.equal((await post({ ...base, confidence: 0 })).status, 201);
    assert.equal((await post({ ...base, confidence: 1 })).status, 201);
    assert.equal((await post({ ...base, dependsOn: Array.from({ length: 51 }, (_, i) => `n${i}`) })).status, 400);
    assert.equal((await post({ ...base, meta: "string" })).status, 400);
    for (const id of ["a b", "../x", "x".repeat(65), "a'b", "a;b", "é", ""]) {
      assert.equal((await post({ ...base, id })).status, 400, JSON.stringify(id));
    }
    assert.equal((await post({ ...base, id: "x".repeat(64) })).status, 201);
    assert.equal((await post({ ...base, id: "ns:thing.v1-2_3" })).status, 201);
    assert.equal((await post({ ...base, bogusField: 1 })).status, 201, "unknown fields are stripped");
  });

  it("no node is created by a rejected request", async () => {
    const t = await T("val");
    await call(nodes.POST, { tenant: t, body: { kind: "fact", content: "x" } });
    await call(nodes.POST, { tenant: t, rawBody: "{" });
    assert.equal((await call(graph.GET, { tenant: t })).json.nodes.length, 0);
  });

  it("approve needs an approver; trust needs a valid value", async () => {
    const t = await T("val");
    await call(seed.POST, { tenant: t, method: "POST" });
    assert.equal((await call(approve.POST, { tenant: t, params: { id: "a_wire" }, body: {} })).status, 400);
    assert.equal((await call(approve.POST, { tenant: t, params: { id: "a_wire" }, body: { approver: "" } })).status, 400);
    assert.equal((await call(trust.POST, { tenant: t, params: { id: "s_pm" }, body: { trust: "kinda" } })).status, 400);
    assert.equal((await call(supersede.POST, { tenant: t, params: { id: "f_price" }, body: {} })).status, 400);
  });

  it("hostile ids in the URL are just 404s, never injection", async () => {
    const t = await T("val");
    await call(seed.POST, { tenant: t, method: "POST" });
    for (const id of ["x'}) DETACH DELETE n //", "../../etc", "%00", "a b", "f_price OR 1=1"]) {
      assert.equal((await call(node.GET, { tenant: t, params: { id } })).status, 404, id);
      assert.equal((await call(why.GET, { tenant: t, params: { id } })).status, 404);
      assert.equal((await call(impact.GET, { tenant: t, params: { id } })).status, 404);
    }
    assert.equal((await call(graph.GET, { tenant: t })).json.nodes.length, 14);
  });
});

describe("auth", () => {
  it("is open when STALE_API_KEY is unset", async () => {
    const t = await T("auth");
    assert.equal((await call(graph.GET, { tenant: t })).status, 200);
  });

  it("requires the exact bearer token when set (all routes)", async () => {
    const t = await T("auth");
    process.env.STALE_API_KEY = "s3cret";
    for (const h of [graph.GET, tenants.GET, plan.GET, events.GET]) {
      assert.equal((await call(h as any, { tenant: t })).status, 401);
      assert.equal((await call(h as any, { tenant: t, headers: { authorization: "Bearer wrong" } })).status, 401);
      assert.equal((await call(h as any, { tenant: t, headers: { authorization: "s3cret" } })).status, 401);
      assert.equal((await call(h as any, { tenant: t, headers: { authorization: "Bearer s3cret" } })).status, 200);
    }
    assert.equal((await call(nodes.POST, { tenant: t, body: {} })).status, 401, "401 comes before validation");
  });
});

describe("full flow over HTTP", () => {
  it("seed -> impact -> supersede -> repair -> approve -> execute", async () => {
    const t = await T("flow");
    await call(seed.POST, { tenant: t, method: "POST" });

    const imp = await call(impact.GET, { tenant: t, params: { id: "f_price" } });
    assert.equal(imp.json.count, 7);

    const sup = await call(supersede.POST, {
      tenant: t,
      params: { id: "f_price" },
      body: { content: "Acme now $140/unit", reason: "price hike" },
    });
    assert.equal(sup.status, 200);
    assert.equal(sup.json.impacted.length, 7);
    assert.deepEqual(sup.json.executedActionsAtRisk.map((a: any) => a.id), ["a_po"]);

    const pl = await call(plan.GET, { tenant: t });
    assert.equal(pl.json.total, 7);
    assert.equal(pl.json.layers[0].nodes[0].id, "b_cost");

    assert.equal((await call(resolve.POST, { tenant: t, params: { id: "d_vendor" }, body: {} })).status, 409);
    assert.equal((await call(resolve.POST, { tenant: t, params: { id: "b_cost" }, body: { content: "$140k" } })).status, 200);

    const chk = await call(check.GET, { tenant: t, params: { id: "a_wire" } });
    assert.equal(chk.json.allowed, false);
    assert.equal((await call(check.POST, { tenant: t, params: { id: "a_wire" } })).json.allowed, false);

    const blocked = await call(execute.POST, { tenant: t, method: "POST", params: { id: "a_wire" } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.details.reasons[0].source, "s_ext_email");

    assert.equal((await call(approve.POST, { tenant: t, params: { id: "a_wire" }, body: { approver: "cfo" } })).status, 200);
    assert.equal((await call(execute.POST, { tenant: t, method: "POST", params: { id: "a_wire" } })).status, 200);
    assert.equal((await call(execute.POST, { tenant: t, method: "POST", params: { id: "a_wire" } })).status, 409);

    const w = await call(why.GET, { tenant: t, params: { id: "a_wire" } });
    assert.ok(w.json.ancestors.length >= 3);
    assert.equal((await call(node.GET, { tenant: t, params: { id: "a_wire" } })).json.approved_by, "cfo");
  });

  it("quarantine endpoint taints, restore lifts", async () => {
    const t = await T("flow");
    await call(seed.POST, { tenant: t, method: "POST" });
    const q = await call(trust.POST, { tenant: t, params: { id: "s_vendor" }, body: { trust: "untrusted", reason: "breach" } });
    assert.equal(q.status, 200);
    assert.deepEqual(q.json.executedActions.map((a: any) => a.id), ["a_po"]);
    assert.ok((await call(graph.GET, { tenant: t })).json.tainted.includes("d_vendor"));
    await call(trust.POST, { tenant: t, params: { id: "s_vendor" }, body: { trust: "trusted" } });
    assert.ok(!(await call(graph.GET, { tenant: t })).json.tainted.includes("d_vendor"));
    assert.equal((await call(trust.POST, { tenant: t, params: { id: "ghost" }, body: { trust: "untrusted" } })).status, 404);
  });

  it("POST nodes returns 201 with the gate verdict for actions", async () => {
    const t = await T("flow");
    await call(seed.POST, { tenant: t, method: "POST" });
    const ok = await call(nodes.POST, {
      tenant: t,
      body: { kind: "action", content: "tweet", dependsOn: ["f_date"] },
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.gate.allowed, true);
    const dup = await call(nodes.POST, { tenant: t, body: { id: "f_date", kind: "fact", content: "x", sourceId: "s_pm" } });
    assert.equal(dup.status, 409);
    const missing = await call(nodes.POST, { tenant: t, body: { kind: "belief", content: "x", dependsOn: ["ghost"] } });
    assert.equal(missing.status, 404);
    const dupSrc = await call(sources.POST, { tenant: t, body: { id: "s_pm", name: "again" } });
    assert.equal(dupSrc.status, 409);
    assert.equal((await call(sources.POST, { tenant: t, body: { name: "fresh" } })).status, 201);
  });

  it("events limit is parsed defensively", async () => {
    const t = await T("flow");
    await call(seed.POST, { tenant: t, method: "POST" });
    const n = async (q: string) => (await call(events.GET, { tenant: t, path: `/${q}` })).json.length;
    assert.equal(await n("?limit=3"), 3);
    const total = await n("");
    assert.ok(total > 3 && total <= 50);
    assert.equal(await n("?limit=abc"), total);
    assert.equal(await n("?limit=0"), 1);
    assert.equal(await n("?limit=-9"), 1);
    assert.equal(await n("?limit=2.9"), 2);
    assert.ok((await n("?limit=99999")) <= 500);
  });
});
