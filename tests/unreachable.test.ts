// Must run in its own process: points the app at a port nothing listens on.
process.env.FALKORDB_PORT = "6399";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as health from "../src/app/api/v1/health/route";
import * as graph from "../src/app/api/v1/graph/route";
import * as mcp from "../src/app/api/mcp/route";
import { call } from "./helpers";

describe("FalkorDB down", () => {
  it("returns 503 with a hint instead of hanging or 500ing", async () => {
    for (const [h, headers] of [
      [health.GET, {}],
      [graph.GET, {}],
      [mcp.GET, { accept: "application/json, text/event-stream" }],
    ] as const) {
      const r = await call(h as any, { tenant: "x", headers });
      assert.equal(r.status, 503, JSON.stringify(r.json));
      assert.match(r.json.error, /FalkorDB is unreachable/);
    }
  });

  it("a later request can retry the connection (failure is not cached)", async () => {
    const a = await call(health.GET as any);
    const b = await call(health.GET as any);
    assert.equal(a.status, 503);
    assert.equal(b.status, 503);
  });
});
