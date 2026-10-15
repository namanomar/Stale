import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { StaleError } from "@/lib/errors";
import { jsonBody, plain } from "@/lib/http";
import { ingestDocument } from "@/lib/ingest";
import { Memory } from "@/lib/memory";
import { findIntegration, getOrg } from "@/lib/system";

/** Accepts our own shape and the common inbound-parse shapes (Postmark: From/Subject/TextBody/MessageID). */
const input = z
  .object({
    from: z.string().max(300).optional(),
    From: z.string().max(300).optional(),
    subject: z.string().max(500).optional(),
    Subject: z.string().max(500).optional(),
    text: z.string().max(40000).optional(),
    TextBody: z.string().max(40000).optional(),
    messageId: z.string().max(300).optional(),
    MessageID: z.string().max(300).optional(),
    date: z.string().max(100).optional(),
    Date: z.string().max(100).optional(),
  })
  .passthrough();

const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

/**
 * Forward or auto-forward mail here (Gmail/Outlook rule, Postmark, Mailgun, Zapier...).
 * Mail from your company domains is trusted; mail from anyone else is remembered but untrusted.
 */
export const POST = plain(async (req, { id }) => {
  const integ = findIntegration(id);
  if (!integ || integ.type !== "email") throw new StaleError(404, "Unknown connection");
  const given = req.headers.get("x-stale-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const want = String(integ.config.secret);
  if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
    throw new StaleError(401, "Bad secret");
  }
  const b = await jsonBody(req, input);
  const from = addressOf(b.from ?? b.From ?? "");
  const text = (b.text ?? b.TextBody ?? "").trim();
  if (!from.includes("@") || !text) throw new StaleError(400, "Need a sender address and a text body");
  const domain = from.split("@").pop()!;
  const company: string[] = integ.config.companyDomains ?? [];
  const subject = b.subject ?? b.Subject ?? "";
  const when = Date.parse(b.date ?? b.Date ?? "");
  const org = getOrg(integ.org_id);
  return ingestDocument(org, await Memory.open(org.id), {
    kind: "email",
    integrationId: integ.id,
    externalId: b.messageId ?? b.MessageID ?? `${from}:${subject}:${text.length}:${text.slice(0, 40)}`,
    sourceKey: domain,
    sourceName: `Email · ${domain}`,
    author: from,
    ts: Number.isFinite(when) ? when : undefined,
    text: `${subject ? `Subject: ${subject}\n` : ""}${text}`,
    // Strangers (and look-alike domains) are never in the allow-list.
    untrusted: !company.includes(domain),
  });
});
