import { route } from "@/lib/http";

export const GET = route(async ({ mem, params }) => {
  const impacted = await mem.impact(params.id);
  return { id: params.id, count: impacted.length, impacted };
});
