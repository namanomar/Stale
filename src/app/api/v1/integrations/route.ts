import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PULL, normalizeJiraSite } from "@/lib/connectors";
import { badRequest } from "@/lib/errors";
import { route } from "@/lib/http";
import { slackAuthTest } from "@/lib/slack";
import { createIntegration, listIntegrations } from "@/lib/system";

const hookPath: Record<string, string> = { slack: "slack", webhook: "generic", email: "email" };

export const GET = route(async ({ principal, req }) => {
  const origin = new URL(req.url).origin;
  return listIntegrations(principal.org.id).map((i) => ({
    ...i,
    webhookUrl: hookPath[i.type] ? `${origin}/api/hooks/${hookPath[i.type]}/${i.id}` : undefined,
    syncable: i.type in PULL,
  }));
});

const name = (d: string) => z.string().trim().min(1).max(80).default(d);

const input = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("slack"),
    name: name("Slack"),
    signingSecret: z.string().trim().min(8).max(200),
    botToken: z.string().trim().max(300).optional(),
    untrustedChannels: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("webhook"), name: z.string().trim().min(1).max(80) }),
  z.object({
    type: z.literal("email"),
    name: name("Email"),
    /** Senders from these domains are your company; everyone else is untrusted. */
    companyDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).default([]),
  }),
  z.object({ type: z.literal("github"), name: name("GitHub"), token: z.string().trim().min(10).max(300) }),
  z.object({
    type: z.literal("jira"),
    name: name("Jira"),
    site: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(200),
    token: z.string().trim().min(8).max(500),
  }),
  z.object({ type: z.literal("notion"), name: name("Notion"), token: z.string().trim().min(10).max(300) }),
]);

export const POST = route(
  async ({ principal, body, req }) => {
    const b = await body(input);
    const origin = new URL(req.url).origin;
    const org = principal.org.id;

    if (b.type === "slack") {
      let teamId: string | undefined;
      if (b.botToken) {
        try {
          teamId = (await slackAuthTest(b.botToken)).teamId;
        } catch (e) {
          throw badRequest(`Slack rejected that bot token (${e instanceof Error ? e.message : e})`);
        }
      }
      const i = createIntegration(org, "slack", b.name, {
        signingSecret: b.signingSecret,
        botToken: b.botToken,
        teamId,
        untrustedChannels: b.untrustedChannels ?? [],
      });
      return Response.json({ ...i, webhookUrl: `${origin}/api/hooks/slack/${i.id}`, syncable: true }, { status: 201 });
    }

    if (b.type === "webhook" || b.type === "email") {
      const secret = `whs_${randomBytes(18).toString("base64url")}`;
      const i = createIntegration(org, b.type, b.name, {
        secret,
        ...(b.type === "email" ? { companyDomains: b.companyDomains } : {}),
      });
      return Response.json({ ...i, secret, webhookUrl: `${origin}/api/hooks/${hookPath[b.type]}/${i.id}` }, { status: 201 });
    }

    // Token connectors: prove the credentials work before saving anything.
    const cfg =
      b.type === "jira"
        ? { site: normalizeJiraSite(b.site), email: b.email, token: b.token }
        : { token: b.token };
    const who = await PULL[b.type].test(cfg);
    const i = createIntegration(org, b.type, b.name, cfg);
    return Response.json({ ...i, account: who, syncable: true }, { status: 201 });
  },
  { min: "admin" },
);
