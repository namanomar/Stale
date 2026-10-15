import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./http";
import { resolveSession, type Principal } from "./system";

/** The signed-in principal for server components, or null. */
export async function getPrincipal(): Promise<Principal | null> {
  const jar = await cookies();
  return await resolveSession(jar.get(SESSION_COOKIE)?.value);
}
