import { route } from "@/lib/http";
import { sourceInput } from "@/lib/schemas";

export const GET = route(({ mem }) => mem.listSources());
export const POST = route(async ({ mem, body }) => {
  const rec = await mem.addSource(await body(sourceInput));
  return Response.json(rec, { status: 201 });
});
