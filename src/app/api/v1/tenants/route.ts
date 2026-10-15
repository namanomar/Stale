import { authDisabled, authenticate, errorResponse } from "@/lib/http";
import { listTenants } from "@/lib/db";

/** Dev/test only lists every graph; with auth on you only ever see your own workspace. */
export async function GET(req: Request) {
  try {
    const principal = await authenticate(req);
    return Response.json(authDisabled() ? await listTenants() : [principal.org.id]);
  } catch (err) {
    return errorResponse(err);
  }
}
