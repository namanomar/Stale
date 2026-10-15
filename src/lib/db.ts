import { FalkorDB } from "falkordb";
import { badRequest } from "./errors";

type Graph = ReturnType<FalkorDB["selectGraph"]>;

const g = globalThis as unknown as {
  __staleDb?: Promise<FalkorDB>;
  __staleReady?: Set<string>;
};

function connect(): Promise<FalkorDB> {
  if (!g.__staleDb) {
    g.__staleDb = FalkorDB.connect({
      socket: {
        host: process.env.FALKORDB_HOST ?? "localhost",
        port: Number(process.env.FALKORDB_PORT ?? 6379),
      },
      username: process.env.FALKORDB_USERNAME,
      password: process.env.FALKORDB_PASSWORD,
    }).catch((err) => {
      g.__staleDb = undefined; // allow retry on next request
      throw err;
    });
  }
  return g.__staleDb;
}

export function normalizeTenant(raw: string | null | undefined): string {
  const tenant = (raw ?? "demo").trim();
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(tenant)) {
    throw badRequest("tenant must match [A-Za-z0-9_-]{1,48}");
  }
  return tenant;
}

/** One isolated FalkorDB graph per tenant. */
export async function graphFor(tenant: string): Promise<Graph> {
  const db = await connect();
  const graph = db.selectGraph(`stale:${tenant}`);
  g.__staleReady ??= new Set();
  if (!g.__staleReady.has(tenant)) {
    for (const label of ["Node", "Source", "Event"]) {
      try {
        await graph.createNodeRangeIndex(label, "id");
      } catch (e) {
        if (!/already indexed|already exists/i.test(String(e))) throw e;
      }
    }
    g.__staleReady.add(tenant);
  }
  return graph;
}

export async function dropTenant(tenant: string) {
  const db = await connect();
  try {
    await db.selectGraph(`stale:${tenant}`).delete();
  } catch (e) {
    if (!/empty key|not found|invalid graph/i.test(String(e))) throw e;
  }
  g.__staleReady?.delete(tenant);
}

export async function listTenants(): Promise<string[]> {
  const db = await connect();
  const all = await db.list();
  return all.filter((n: string) => n.startsWith("stale:")).map((n: string) => n.slice(6));
}

/** Close the shared connection (tests / scripts). */
export async function closeDb() {
  if (!g.__staleDb) return;
  const db = await g.__staleDb;
  g.__staleDb = undefined;
  g.__staleReady = undefined;
  await db.close();
}
