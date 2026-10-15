import { z } from "zod";
import { PULL } from "@/lib/connectors";
import { badRequest } from "@/lib/errors";
import { route } from "@/lib/http";
import { getIntegration, integrationConfig } from "@/lib/system";
import { ingestAll, streamJob } from "@/lib/sync";

/** GET lists what can be synced (channels, repos, projects, pages). */
export const GET = route(async ({ principal, params }) => {
  const i = await getIntegration(principal.org.id, params.id);
  const c = PULL[i.type];
  if (!c) throw badRequest(`${i.type} connections are push-only; there is nothing to import`);
  return { noun: c.scopeNoun, label: c.label, items: await c.scopes(await integrationConfig(principal.org.id, i.id)) };
});

/** POST imports the chosen scope and streams progress as newline-delimited JSON. */
export const POST = route(
  async ({ principal, mem, params, body, req }) => {
    const { scope, limit } = await body(
      z.object({
        scope: z.array(z.string().max(200)).min(1).max(30),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    );
    const i = await getIntegration(principal.org.id, params.id);
    const c = PULL[i.type];
    if (!c) throw badRequest(`${i.type} connections cannot be imported`);
    const cfg = await integrationConfig(principal.org.id, i.id);
    return streamJob(async (send) => {
      send({ t: "stage", text: `Fetching from ${c.label}…` });
      const docs = await c.pull(cfg, i.id, scope, limit);
      send({ t: "stage", text: `Reading ${docs.length} item${docs.length === 1 ? "" : "s"} and extracting facts…` });
      return ingestAll(principal.org, mem, docs, send, req.signal);
    });
  },
  { min: "admin" },
);
