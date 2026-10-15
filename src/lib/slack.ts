import { createHmac, timingSafeEqual } from "node:crypto";
import { StaleError } from "./errors";
import type { IngestDoc } from "./ingest";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SlackConfig {
  /** From the Slack app's Basic Information page; used to verify every webhook. */
  signingSecret: string;
  /** xoxb-... token, optional: lets us resolve channel/user names and backfill history. */
  botToken?: string;
  /** Team (workspace) id; messages from other teams are external. */
  teamId?: string;
  /** Channel ids that should always be treated as untrusted (e.g. shared with customers). */
  untrustedChannels?: string[];
  names?: Record<string, string>;
}

/** https://api.slack.com/authentication/verifying-requests-from-slack */
export function verifySlackSignature(secret: string, timestamp: string | null, signature: string | null, raw: string) {
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false; // replay window
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function slackApi(token: string, method: string, params: Record<string, string>) {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json();
  if (!json.ok) throw new StaleError(502, `Slack ${method}: ${json.error}`);
  return json;
}

async function nameOf(cfg: SlackConfig, kind: "channel" | "user", id: string): Promise<string> {
  const key = `${kind}:${id}`;
  const cached = cfg.names?.[key];
  if (cached) return cached;
  if (!cfg.botToken) return id;
  try {
    const name =
      kind === "channel"
        ? "#" + (await slackApi(cfg.botToken, "conversations.info", { channel: id })).channel.name
        : ((j) => j.user.profile?.real_name || j.user.name)(await slackApi(cfg.botToken, "users.info", { user: id }));
    (cfg.names ??= {})[key] = name;
    return name;
  } catch {
    return id;
  }
}

/** Turn a Slack Events API callback into a document, or null if it is not worth ingesting. */
export async function slackEventToDoc(cfg: SlackConfig, integrationId: string, payload: any): Promise<IngestDoc | null> {
  const e = payload.event;
  if (!e || e.type !== "message") return null;
  // Edits/deletes/joins etc. carry a subtype; plain messages and thread broadcasts do not matter beyond that.
  if (e.subtype && !["thread_broadcast", "bot_message", "file_share"].includes(e.subtype)) return null;
  const text: string = (e.text ?? "").trim();
  if (!text) return null;

  const channel = await nameOf(cfg, "channel", e.channel);
  const author = e.user ? await nameOf(cfg, "user", e.user) : (e.username ?? "bot");
  const teamId = cfg.teamId ?? payload.team_id;
  const external =
    !!payload.is_ext_shared_channel || // Slack Connect with another company
    !!e.bot_id || // other apps can say anything
    (!!e.user_team && !!teamId && e.user_team !== teamId) || // user from another workspace
    !!cfg.untrustedChannels?.includes(e.channel);

  return {
    kind: "slack",
    integrationId,
    externalId: `${e.channel}:${e.ts}`,
    sourceKey: e.channel,
    sourceName: `Slack ${channel}`,
    author,
    ts: Math.round(Number(e.ts) * 1000),
    text,
    untrusted: external,
  };
}

/** Pull recent history for one channel (used right after connecting, and by "Sync now"). */
export async function slackBackfill(cfg: SlackConfig, integrationId: string, channelId: string, limit = 100): Promise<IngestDoc[]> {
  if (!cfg.botToken) throw new StaleError(400, "Add a bot token to this Slack connection to read history");
  const hist = await slackApi(cfg.botToken, "conversations.history", { channel: channelId, limit: String(Math.min(limit, 200)) });
  const docs: IngestDoc[] = [];
  for (const m of (hist.messages ?? []).reverse()) {
    const d = await slackEventToDoc(cfg, integrationId, { team_id: cfg.teamId, event: { type: "message", channel: channelId, ...m } });
    if (d) docs.push(d);
  }
  return docs;
}

export async function slackChannels(cfg: SlackConfig) {
  if (!cfg.botToken) throw new StaleError(400, "No bot token configured");
  const r = await slackApi(cfg.botToken, "conversations.list", { types: "public_channel", limit: "200", exclude_archived: "true" });
  return (r.channels as any[]).map((c) => ({ id: c.id as string, name: c.name as string, member: !!c.is_member }));
}

export async function slackAuthTest(token: string) {
  const r = await slackApi(token, "auth.test", {});
  return { teamId: r.team_id as string, team: r.team as string };
}
