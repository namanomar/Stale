import { randomUUID } from "node:crypto";
import { z } from "zod";
import { route } from "@/lib/http";
import { ingestDocument } from "@/lib/ingest";
import { ingestRecent } from "@/lib/system";

const input = z.object({
  kind: z.enum(["slack", "webhook", "email", "upload", "manual", "github", "jira", "notion", "drive"]).default("manual"),
  /** Where it was said, e.g. "#pricing" or "Email from vendor". Messages with the same value share one Source. */
  source: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(20000),
  author: z.string().trim().max(120).optional(),
  untrusted: z.boolean().optional(),
  externalId: z.string().max(200).optional(),
  url: z.string().url().max(500).optional(),
  /** When it was said (ms since epoch); defaults to now. */
  ts: z.number().int().min(0).max(4102444800000).optional(),
});

/** Feed any text into the memory. Connectors, the simulator and uploads all end up here. */
export const POST = route(async ({ principal, mem, body }) => {
  const b = await body(input);
  return ingestDocument(principal.org, mem, {
    kind: b.kind,
    externalId: b.externalId ?? `manual:${randomUUID()}`,
    sourceKey: b.source,
    sourceName: b.kind === "slack" ? `Slack ${b.source}` : b.source,
    author: b.author,
    url: b.url,
    ts: b.ts,
    text: b.text,
    untrusted: b.untrusted,
  });
});

export const GET = route(async ({ principal }) => ingestRecent(principal.org.id));
