import { route } from "@/lib/http";
import { resolveInput } from "@/lib/schemas";

export const POST = route(async ({ mem, params, body }) =>
  mem.resolve(params.id, await body(resolveInput)),
);
