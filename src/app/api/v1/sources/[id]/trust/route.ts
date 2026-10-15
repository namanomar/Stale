import { route } from "@/lib/http";
import { trustInput } from "@/lib/schemas";

/** Quarantine ({"trust":"untrusted"}) or restore a source; taint follows the graph. */
export const POST = route(async ({ mem, params, body }) => {
  const { trust, reason } = await body(trustInput);
  return mem.setTrust(params.id, trust, reason);
});
