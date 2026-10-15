import { route } from "@/lib/http";
import { nodeInput } from "@/lib/schemas";

export const POST = route(async ({ mem, body }) => {
  const res = await mem.addNode(await body(nodeInput));
  return Response.json(res, { status: 201 });
});
