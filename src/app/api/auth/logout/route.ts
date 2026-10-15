import { clearCookie, plain, readCookie, SESSION_COOKIE } from "@/lib/http";
import { deleteSession } from "@/lib/system";

export const POST = plain(async (req) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) deleteSession(token);
  return Response.json({ ok: true }, { headers: { "set-cookie": clearCookie } });
});
