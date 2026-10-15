process.env.STALE_AUTH = "off"; // tests drive the engine directly; auth has its own suite
import assert from "node:assert/strict";
import { after } from "node:test";
import { closeDb } from "../src/lib/db";
import { Memory } from "../src/lib/memory";
import { StaleError } from "../src/lib/errors";
import type { NodeRec } from "../src/lib/types";

const created: Memory[] = [];
let counter = 0;

/** A brand-new isolated tenant; dropped automatically when the test file ends. */
export async function fresh(label = "t"): Promise<Memory> {
  const name = `test_${label}_${Date.now().toString(36)}_${process.pid}_${counter++}`;
  const mem = await Memory.open(name);
  created.push(mem);
  return mem;
}

export function cleanupAfterAll() {
  after(async () => {
    for (const m of created) await m.reset().catch(() => {});
    await closeDb();
  });
}

export async function rejectsWith(p: Promise<unknown>, status: number, msg?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof StaleError, `expected StaleError, got ${String(e)}`);
    assert.equal(e.status, status, `status: ${e.message}`);
    if (msg) assert.match(e.message, msg);
    return true;
  });
}

/** Seed helper: one trusted source + facts. */
export async function withFacts(mem: Memory, ...ids: string[]) {
  await mem.addSource({ id: "s", name: "src" });
  for (const id of ids) await mem.addNode({ id, kind: "fact", content: `fact ${id}`, sourceId: "s" });
}

/**
 * Structural invariants that must hold after ANY sequence of operations.
 * Returns the snapshot for further assertions.
 */
export async function checkInvariants(mem: Memory) {
  const snap = await mem.snapshot();
  const byId = new Map<string, NodeRec>(snap.nodes.map((n) => [n.id, n]));
  const sourceIds = new Set(snap.sources.map((s) => s.id));
  assert.equal(byId.size, snap.nodes.length, "node ids unique");

  const parents = new Map<string, string[]>();
  const supersededBy = new Map<string, string[]>();
  for (const e of snap.edges) {
    if (e.type === "DEPENDS_ON") {
      assert.ok(byId.has(e.from) && byId.has(e.to), `dangling DEPENDS_ON ${e.from}->${e.to}`);
      parents.set(e.from, [...(parents.get(e.from) ?? []), e.to]);
    } else if (e.type === "FROM") {
      assert.ok(byId.has(e.from) && sourceIds.has(e.to), `dangling FROM ${e.from}->${e.to}`);
    } else {
      assert.ok(byId.has(e.from) && byId.has(e.to), "dangling SUPERSEDES");
      supersededBy.set(e.to, [...(supersededBy.get(e.to) ?? []), e.from]);
    }
  }
  for (const n of snap.nodes) {
    const ps = parents.get(n.id) ?? [];
    if (n.kind !== "fact") assert.ok(ps.length > 0, `${n.id}: derived node without dependencies`);
    if (n.status === "valid") {
      for (const p of ps) {
        assert.equal(byId.get(p)!.status, "valid", `valid ${n.id} depends on non-valid ${p}`);
      }
    }
    if (n.status === "superseded") {
      assert.ok((supersededBy.get(n.id) ?? []).length >= 1, `${n.id} superseded but no successor`);
    } else {
      assert.ok(!supersededBy.has(n.id), `${n.id} has a successor but is ${n.status}`);
    }
    if (n.status === "stale") assert.ok(n.stale_root, `${n.id} stale without root`);
  }
  // DAG: Kahn's algorithm must consume every node.
  const indeg = new Map<string, number>(snap.nodes.map((n) => [n.id, (parents.get(n.id) ?? []).length]));
  const children = new Map<string, string[]>();
  for (const [c, ps] of parents) for (const p of ps) children.set(p, [...(children.get(p) ?? []), c]);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([i]) => i);
  let seen = 0;
  while (queue.length) {
    const x = queue.pop()!;
    seen++;
    for (const c of children.get(x) ?? []) {
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) queue.push(c);
    }
  }
  assert.equal(seen, snap.nodes.length, "dependency graph has a cycle");
  // Gate sanity: an un-executed, non-approved action is blocked iff the firewall says so.
  for (const n of snap.nodes) {
    if (n.kind === "action" && !n.executed_at && n.gate !== "approved" && n.status !== "superseded") {
      const v = await mem.checkAction(n.id);
      assert.equal(n.gate, v.allowed ? "allowed" : "blocked", `gate drift on ${n.id}`);
    }
  }
  return snap;
}

export async function statusOf(mem: Memory, id: string) {
  return (await mem.getNode(id)).status;
}

type RouteHandler = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

/** Invoke a Next route handler directly, no server needed. */
export async function call(
  handler: RouteHandler,
  opts: {
    method?: string;
    path?: string;
    tenant?: string;
    body?: unknown;
    rawBody?: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.tenant !== undefined) headers["x-tenant-id"] = opts.tenant;
  let body: string | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  const res = await handler(
    new Request(`http://localhost${opts.path ?? "/"}`, {
      method: opts.method ?? (body !== undefined ? "POST" : "GET"),
      headers,
      body,
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, res };
}
