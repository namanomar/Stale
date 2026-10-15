import { errorResponse } from "@/lib/http";
import { listTenants } from "@/lib/db";

export async function GET() {
  try {
    const tenants = await listTenants();
    return Response.json({ ok: true, falkordb: "connected", tenants: tenants.length });
  } catch (err) {
    return errorResponse(err);
  }
}
