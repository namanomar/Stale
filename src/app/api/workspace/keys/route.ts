import { z } from "zod";
import { route } from "@/lib/http";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/system";

export const GET = route(async ({ principal }) => listApiKeys(principal.org.id), { min: "admin" });

export const POST = route(
  async ({ principal, body }) => {
    const { name } = await body(z.object({ name: z.string().trim().min(1).max(60) }));
    return Response.json(createApiKey(principal.org.id, name), { status: 201 });
  },
  { min: "admin" },
);

export const DELETE = route(
  async ({ principal, url }) => {
    revokeApiKey(principal.org.id, url.searchParams.get("id") ?? "");
    return { ok: true };
  },
  { min: "admin" },
);
