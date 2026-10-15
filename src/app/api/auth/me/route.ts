import { z } from "zod";
import { authenticate, jsonBody, plain, readCookie, SESSION_COOKIE } from "@/lib/http";
import { StaleError } from "@/lib/errors";
import { orgsOf, pendingReviewCount, switchOrg } from "@/lib/system";

export const GET = plain(async (req) => {
  const p = await authenticate(req);
  return {
    user: p.user,
    org: p.org,
    role: p.role,
    orgs: p.user ? (await orgsOf(p.user.id)).map((o) => ({ id: o.id, name: o.name, role: o.role })) : [],
    pendingReviews: await pendingReviewCount(p.org.id),
  };
});

/** Switch the active workspace of the current session. */
export const POST = plain(async (req) => {
  const { orgId } = await jsonBody(req, z.object({ orgId: z.string().max(64) }));
  const p = await authenticate(req);
  const token = readCookie(req, SESSION_COOKIE);
  if (!p.user || !token) throw new StaleError(400, "Only browser sessions can switch workspace");
  await switchOrg(token, p.user.id, orgId);
  return { ok: true };
});
