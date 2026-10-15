import { route } from "@/lib/http";
import { deleteIntegration } from "@/lib/system";

export const DELETE = route(
  async ({ principal, params }) => {
    await deleteIntegration(principal.org.id, params.id);
    return { ok: true };
  },
  { min: "admin" },
);
