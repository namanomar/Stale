import { ZodError, type ZodType } from "zod";
import { normalizeTenant } from "./db";
import { StaleError } from "./errors";
import { Memory } from "./memory";
import { ROLE_RANK, resolveApiKey, resolveSession, type Principal, type Role } from "./system";

export interface Ctx {
  req: Request;
  mem: Memory;
  params: Record<string, string>;
  url: URL;
  /** Who is calling (session user or API key) and which workspace they act in. */
  principal: Principal;
  /** Parse and validate the JSON body. */
  body: <T>(schema: ZodType<T>) => Promise<T>;
}

export const SESSION_COOKIE = "stale_session";

export function authDisabled() {
  return process.env.STALE_AUTH === "off";
}

export function readCookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

/**
 * Who is calling? A signed-in browser session or an `Authorization: Bearer sk_...` API key.
 * `STALE_AUTH=off` (local dev / tests only) trusts the `x-tenant-id` header instead.
 */
export function authenticate(req: Request, url = new URL(req.url)): Principal {
  if (authDisabled()) {
    const key = process.env.STALE_API_KEY;
    if (key && req.headers.get("authorization") !== `Bearer ${key}`) {
      throw new StaleError(401, "Missing or invalid API key");
    }
    const tenant = normalizeTenant(req.headers.get("x-tenant-id") ?? url.searchParams.get("tenant"));
    return { user: null, org: { id: tenant, name: tenant, settings: { autoApply: "trusted" } }, role: "admin", via: "api_key" };
  }
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const p = bearer ? resolveApiKey(bearer) : resolveSession(readCookie(req, SESSION_COOKIE));
  if (!p) throw new StaleError(401, "Sign in required");
  return p;
}

export function requireRole(p: Principal, min: Role) {
  if (ROLE_RANK[p.role] < ROLE_RANK[min]) throw new StaleError(403, `This needs the ${min} role`);
}

const NET_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "EPIPE"]);

/** Node wraps dual-stack failures in an AggregateError with an empty message; look inside. */
function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; errors?: unknown[]; cause?: unknown };
  if (e.code && NET_CODES.has(e.code)) return true;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Socket closed|connection is closed/i.test(e.message ?? "")) return true;
  return (e.errors ?? []).some(isConnectionError) || isConnectionError(e.cause);
}

export function errorResponse(err: unknown) {
  if (err instanceof StaleError) {
    return Response.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return Response.json({ error: "Invalid request", details: err.issues }, { status: 400 });
  }
  const msg = err instanceof Error ? err.message || String(err) : String(err);
  if (isConnectionError(err)) {
    return Response.json(
      { error: "FalkorDB is unreachable. Is it running? (docker compose up -d)", details: msg },
      { status: 503 },
    );
  }
  console.error(err);
  return Response.json({ error: "Internal error", details: msg }, { status: 500 });
}

/** Wrap a handler: auth, role check, tenant resolution, body parsing, uniform errors. */
export function route(
  fn: (ctx: Ctx) => Promise<unknown>,
  opts: { min?: Role } = {},
) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }) => {
    try {
      const url = new URL(req.url);
      const principal = authenticate(req, url);
      requireRole(principal, opts.min ?? (req.method === "GET" ? "viewer" : "member"));
      const mem = await Memory.open(principal.org.id);
      const params = (await routeCtx?.params) ?? {};
      const body = async <T,>(schema: ZodType<T>) => {
        let json: unknown = {};
        const text = await req.text();
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            throw new StaleError(400, "Body must be valid JSON");
          }
        }
        return schema.parse(json);
      };
      const result = await fn({ req, mem, params, url, principal, body });
      return result instanceof Response ? result : Response.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** For routes that are not workspace-scoped (signup, login, webhooks). */
export function plain(fn: (req: Request, params: Record<string, string>) => Promise<unknown>) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }) => {
    try {
      const result = await fn(req, (await routeCtx?.params) ?? {});
      return result instanceof Response ? result : Response.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function jsonBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new StaleError(400, "Body must be valid JSON");
    }
  }
  return schema.parse(json);
}

export function sessionCookie(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
