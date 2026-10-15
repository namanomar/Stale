import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { StaleError } from "@/lib/errors";
import { jsonBody, plain } from "@/lib/http";
import { ingestDocument } from "@/lib/ingest";
import { Memory } from "@/lib/memory";
import { findIntegration, getOrg } from "@/lib/system";

const input = z.object({
  text: z.string().trim().min(1).max(20000),
  source: z.string().trim().min(1).max(120).default("Webhook"),
  author: z.string().trim().max(120).optional(),
  id: z.string().max(200).optional(),
  url: z.string().url().max(500).optional(),
  untrusted: z.boolean().optional(),
});

/** Connect anything: Zapier, n8n, a cron job, your CRM. POST JSON with the connection's secret. */
export const POST = plain(async (req, { id }) => {
  const integ = await findIntegration(id);
  if (!integ || integ.type !== "webhook") throw new StaleError(404, "Unknown connection");
  const given =
    req.headers.get("x-stale-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const want = String(integ.config.secret);
  if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
    throw new StaleError(401, "Bad secret");
  }
  const b = await jsonBody(req, input);
  const org = await getOrg(integ.org_id);
  return ingestDocument(org, await Memory.open(org.id), {
    kind: "webhook",
    integrationId: integ.id,
    externalId: b.id ?? `${Date.now()}:${Math.random()}`,
    sourceKey: b.source,
    sourceName: b.source,
    author: b.author,
    url: b.url,
    text: b.text,
    untrusted: b.untrusted,
  });
});
