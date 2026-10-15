import { z } from "zod";
import { route } from "@/lib/http";
import { updateOrg } from "@/lib/system";

export const GET = route(async ({ principal }) => ({ org: principal.org, role: principal.role }));

export const PATCH = route(
  async ({ principal, body }) => {
    const patch = await body(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        settings: z.object({ autoApply: z.enum(["trusted", "never"]).optional() }).optional(),
      }),
    );
    return await updateOrg(principal.org.id, patch);
  },
  { min: "admin" },
);
