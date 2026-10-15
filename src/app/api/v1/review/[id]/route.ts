import { z } from "zod";
import { route } from "@/lib/http";
import { decideReviewItem } from "@/lib/ingest";
import { getReview } from "@/lib/system";

export const POST = route(async ({ principal, mem, params, body }) => {
  const { decision } = await body(z.object({ decision: z.enum(["approved", "rejected"]) }));
  const item = await getReview(principal.org.id, params.id);
  return decideReviewItem(principal.org, mem, item, decision, principal.user?.name ?? "API key");
});
