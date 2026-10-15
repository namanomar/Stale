import { route } from "@/lib/http";
import { loadSample } from "@/lib/sample";
import { streamJob } from "@/lib/sync";

/** Load the "Northwind Robotics" story into this workspace, streaming progress. Safe to run twice. */
export const POST = route(
  async ({ principal, mem, req }) => streamJob((send) => loadSample(principal.org, mem, send, req.signal)),
  { min: "admin" },
);
