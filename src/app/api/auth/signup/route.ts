import { z } from "zod";
import { jsonBody, plain, sessionCookie } from "@/lib/http";
import { createAccount, createSession } from "@/lib/system";

const input = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  orgName: z.string().trim().min(1).max(80),
});

export const POST = plain(async (req) => {
  const body = await jsonBody(req, input);
  const { user, org } = await createAccount(body);
  const { token, maxAge } = await createSession(user.id, org.id);
  return Response.json({ user, org }, { status: 201, headers: { "set-cookie": sessionCookie(token, maxAge) } });
});
