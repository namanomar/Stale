import { z } from "zod";
import { jsonBody, plain, sessionCookie } from "@/lib/http";
import { createSession, orgsOf, verifyLogin } from "@/lib/system";
import { StaleError } from "@/lib/errors";

const input = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });

// Small in-memory brake against password guessing (per email+ip, 8 tries / 10 min).
const attempts = new Map<string, { n: number; reset: number }>();

export const POST = plain(async (req) => {
  const { email, password } = await jsonBody(req, input);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const key = `${email.toLowerCase()}|${ip}`;
  const a = attempts.get(key);
  if (a && a.reset > Date.now() && a.n >= 8) throw new StaleError(429, "Too many attempts. Try again in a few minutes.");
  let user;
  try {
    user = verifyLogin(email, password);
  } catch (e) {
    const cur = a && a.reset > Date.now() ? a : { n: 0, reset: Date.now() + 10 * 60_000 };
    attempts.set(key, { n: cur.n + 1, reset: cur.reset });
    throw e;
  }
  attempts.delete(key);
  const orgs = orgsOf(user.id);
  if (!orgs.length) throw new StaleError(403, "This account has no workspace");
  const { token, maxAge } = createSession(user.id, orgs[0].id);
  return Response.json({ user, org: orgs[0] }, { headers: { "set-cookie": sessionCookie(token, maxAge) } });
});
