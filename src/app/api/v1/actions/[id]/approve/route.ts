import { route } from "@/lib/http";
import { approveInput } from "@/lib/schemas";

export const POST = route(async ({ mem, params, body }) => {
  const { approver, note } = await body(approveInput);
  return mem.approveAction(params.id, approver, note);
});
