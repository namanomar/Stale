import { StaleError } from "@/lib/errors";
import { plain } from "@/lib/http";
import { ingestDocument } from "@/lib/ingest";
import { Memory } from "@/lib/memory";
import { slackEventToDoc, verifySlackSignature, type SlackConfig } from "@/lib/slack";
import { findIntegration, getOrg, updateIntegrationConfig } from "@/lib/system";

/**
 * Slack Events API endpoint. Set it as the Request URL in the Slack app (Event Subscriptions) and
 * subscribe to message.channels. Every request is verified against the connection's signing secret.
 */
export const POST = plain(async (req, { id }) => {
  const raw = await req.text();
  const integ = await findIntegration(id);
  if (!integ || integ.type !== "slack") throw new StaleError(404, "Unknown connection");
  const cfg = integ.config as SlackConfig;
  if (
    !verifySlackSignature(
      cfg.signingSecret,
      req.headers.get("x-slack-request-timestamp"),
      req.headers.get("x-slack-signature"),
      raw,
    )
  ) {
    throw new StaleError(401, "Bad Slack signature");
  }
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new StaleError(400, "Bad JSON");
  }
  if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });
  if (payload.type !== "event_callback") return { ok: true };

  const org = await getOrg(integ.org_id);
  const doc = await slackEventToDoc(cfg, integ.id, payload);
  if (!doc) return { ok: true, ignored: true };
  // Slack retries slow responses; the ingest ledger makes a retry a no-op.
  const result = await ingestDocument(org, await Memory.open(org.id), doc);
  if (cfg.names) await updateIntegrationConfig(org.id, integ.id, { names: cfg.names });
  return { ok: true, status: result.status };
});
