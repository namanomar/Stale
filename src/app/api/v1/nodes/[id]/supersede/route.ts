import { route } from "@/lib/http";
import { supersedeInput } from "@/lib/schemas";

/** A fact changed: version it and cascade staleness through everything built on it. */
export const POST = route(async ({ mem, params, body }) =>
  mem.supersede(params.id, await body(supersedeInput)),
);
