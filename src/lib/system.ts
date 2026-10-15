/**
 * Control-plane store: accounts, workspaces, sessions, API keys, integrations, the review queue
 * and the ingest ledger. The *memory* (facts, beliefs, provenance) lives in FalkorDB, one graph
 * per workspace; everything about who may touch it lives here.
 *
 * Uses Node's built-in SQLite (no native dependency). Loaded via process.getBuiltinModule so the
 * bundler never tries to resolve it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { badRequest, conflict, notFound, StaleError } from "./errors";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = import("node:sqlite").DatabaseSync;

const g = globalThis as unknown as { __staleSys?: Db };

export type Role = "viewer" | "member" | "admin";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

export interface User {
  id: string;
  email: string;
  name: string;
}
export interface Org {
  id: string;
  name: string;
  settings: OrgSettings;
}
export interface OrgSettings {
  /** When may extracted knowledge change memory without a human? */
  autoApply: "trusted" | "never";
}
const DEFAULT_SETTINGS: OrgSettings = { autoApply: "trusted" };

export function sys(): Db {
  if (g.__staleSys) return g.__staleSys;
  const sqlite = (process as any).getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const file = process.env.STALE_DB ?? "data/stale.db";
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL, PRIMARY KEY (org_id, user_id));
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL, last_used INTEGER);
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      type TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'connected',
      created_at INTEGER NOT NULL, last_event INTEGER, events INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL, created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER);
    CREATE INDEX IF NOT EXISTS review_org ON review_items(org_id, status);
    CREATE TABLE IF NOT EXISTS ingest_log (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, external_id TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, kind, external_id));
  `);
  g.__staleSys = db;
  return db;
}

export function closeSys() {
  g.__staleSys?.close();
  g.__staleSys = undefined;
}

const now = () => Date.now();
const rid = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// node:sqlite returns null-prototype rows; copy them so they can cross the server/client boundary.
const q = <T = any,>(sql: string, ...args: any[]) => sys().prepare(sql).all(...args).map((r) => ({ ...r })) as T[];
const one = <T = any,>(sql: string, ...args: any[]) => {
  const r = sys().prepare(sql).get(...args);
  return r ? ({ ...r } as T) : undefined;
};
const run = (sql: string, ...args: any[]) => sys().prepare(sql).run(...args);

/* ------------------------------------------------------------------ */
/* Secrets at rest (integration tokens)                                */
/* ------------------------------------------------------------------ */

function key(): Buffer {
  const secret = process.env.STALE_SECRET ?? "dev-only-secret-change-me";
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/* ------------------------------------------------------------------ */
/* Users, workspaces, sessions                                         */
/* ------------------------------------------------------------------ */

function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, Buffer.from(salt, "hex"), 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

const orgFromRow = (r: any): Org => ({
  id: r.id,
  name: r.name,
  settings: { ...DEFAULT_SETTINGS, ...JSON.parse(r.settings || "{}") },
});

export function createAccount(input: { name: string; email: string; password: string; orgName: string }) {
  const email = input.email.trim().toLowerCase();
  if (one("SELECT id FROM users WHERE email = ?", email)) throw conflict("An account with this email already exists");
  const user: User = { id: rid("usr"), email, name: input.name.trim() };
  const org: Org = { id: rid("org"), name: input.orgName.trim(), settings: DEFAULT_SETTINGS };
  run("INSERT INTO users VALUES (?,?,?,?,?)", user.id, email, user.name, hashPassword(input.password), now());
  run("INSERT INTO orgs VALUES (?,?,?,?)", org.id, org.name, "{}", now());
  run("INSERT INTO members VALUES (?,?,?)", org.id, user.id, "admin");
  return { user, org };
}

/** Operator tool (CLI only, not exposed over HTTP): set a new password and sign the user out everywhere. */
export function resetPassword(email: string, password: string) {
  if (password.length < 8) throw badRequest("Password must be at least 8 characters");
  const row = one("SELECT id FROM users WHERE email = ?", email.trim().toLowerCase());
  if (!row) throw notFound("account", email);
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), row.id);
  run("DELETE FROM sessions WHERE user_id = ?", row.id);
}

export function verifyLogin(email: string, password: string): User {
  const row = one("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
  // Always run a hash to keep timing flat for unknown emails.
  const ok = row ? checkPassword(password, row.password_hash) : (checkPassword(password, "00:" + "0".repeat(128)), false);
  if (!row || !ok) throw new StaleError(401, "Incorrect email or password");
  return { id: row.id, email: row.email, name: row.name };
}
export function orgsOf(userId: string): (Org & { role: Role })[] {
  return q(
    "SELECT o.*, m.role FROM orgs o JOIN members m ON m.org_id = o.id WHERE m.user_id = ? ORDER BY o.created_at",
    userId,
  ).map((r) => ({ ...orgFromRow(r), role: r.role as Role }));
}

export function getOrg(id: string): Org {
  const r = one("SELECT * FROM orgs WHERE id = ?", id);
  if (!r) throw notFound("Workspace", id);
  return orgFromRow(r);
}

export function updateOrg(id: string, patch: { name?: string; settings?: Partial<OrgSettings> }) {
  const org = getOrg(id);
  const name = patch.name?.trim() || org.name;
  const settings = { ...org.settings, ...(patch.settings ?? {}) };
  run("UPDATE orgs SET name = ?, settings = ? WHERE id = ?", name, JSON.stringify(settings), id);
  return getOrg(id);
}

export function listMembers(orgId: string) {
  return q(
    "SELECT u.id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.created_at",
    orgId,
  ) as (User & { role: Role })[];
}

export function addMemberByEmail(orgId: string, email: string, role: Role) {
  const u = one("SELECT id FROM users WHERE email = ?", email.trim().toLowerCase());
  if (!u) throw notFound("User", email);
  run("INSERT OR REPLACE INTO members VALUES (?,?,?)", orgId, u.id, role);
}

export function removeMember(orgId: string, userId: string) {
  const admins = q("SELECT user_id FROM members WHERE org_id = ? AND role = 'admin'", orgId);
  if (admins.length === 1 && admins[0].user_id === userId) throw badRequest("A workspace needs at least one admin");
  run("DELETE FROM members WHERE org_id = ? AND user_id = ?", orgId, userId);
}

const SESSION_MS = 1000 * 60 * 60 * 24 * 14;

export function createSession(userId: string, orgId: string) {
  const token = randomBytes(32).toString("base64url");
  run("INSERT INTO sessions VALUES (?,?,?,?)", sha(token), userId, orgId, now() + SESSION_MS);
  return { token, maxAge: SESSION_MS / 1000 };
}

export interface Principal {
  user: User | null; // null for API keys
  org: Org;
  role: Role;
  via: "session" | "api_key";
}

export function resolveSession(token: string | undefined): Principal | null {
  if (!token) return null;
  const s = one("SELECT * FROM sessions WHERE token_hash = ?", sha(token));
  if (!s || s.expires_at < now()) return null;
  const m = one("SELECT role FROM members WHERE org_id = ? AND user_id = ?", s.org_id, s.user_id);
  const u = one("SELECT id, email, name FROM users WHERE id = ?", s.user_id);
  if (!m || !u) return null;
  return { user: u, org: getOrg(s.org_id), role: m.role, via: "session" };
}

export function switchOrg(token: string, userId: string, orgId: string) {
  if (!one("SELECT 1 FROM members WHERE org_id = ? AND user_id = ?", orgId, userId)) throw notFound("Workspace", orgId);
  run("UPDATE sessions SET org_id = ? WHERE token_hash = ?", orgId, sha(token));
}

export function deleteSession(token: string) {
  run("DELETE FROM sessions WHERE token_hash = ?", sha(token));
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

export function createApiKey(orgId: string, name: string) {
  const secret = `sk_${randomBytes(24).toString("base64url")}`;
  const id = rid("key");
  run("INSERT INTO api_keys VALUES (?,?,?,?,?,?,NULL)", id, orgId, name.trim(), secret.slice(0, 10), sha(secret), now());
  return { id, name, secret }; // the secret is shown once and never stored in clear
}

export function resolveApiKey(secret: string | undefined): Principal | null {
  if (!secret || !secret.startsWith("sk_")) return null;
  const k = one("SELECT * FROM api_keys WHERE key_hash = ?", sha(secret));
  if (!k) return null;
  run("UPDATE api_keys SET last_used = ? WHERE id = ?", now(), k.id);
  return { user: null, org: getOrg(k.org_id), role: "member", via: "api_key" };
}

export function listApiKeys(orgId: string) {
  return q("SELECT id, name, prefix, created_at, last_used FROM api_keys WHERE org_id = ? ORDER BY created_at DESC", orgId);
}

export function revokeApiKey(orgId: string, id: string) {
  const r = run("DELETE FROM api_keys WHERE org_id = ? AND id = ?", orgId, id);
  if (!r.changes) throw notFound("API key", id);
}

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

export type IntegrationType = "slack" | "webhook" | "email" | "upload" | "github" | "drive" | "jira" | "notion";
export interface Integration {
  id: string;
  org_id: string;
  type: IntegrationType;
  name: string;
  status: "connected" | "error" | "paused";
  created_at: number;
  last_event: number | null;
  events: number;
}

const integ = (r: any): Integration => ({
  id: r.id, org_id: r.org_id, type: r.type, name: r.name, status: r.status,
  created_at: r.created_at, last_event: r.last_event, events: r.events,
});

export function createIntegration(orgId: string, type: IntegrationType, name: string, config: Record<string, unknown>) {
  const id = rid("int");
  run("INSERT INTO integrations (id, org_id, type, name, config, created_at) VALUES (?,?,?,?,?,?)",
    id, orgId, type, name.trim(), encrypt(JSON.stringify(config)), now());
  return getIntegration(orgId, id);
}

export function getIntegration(orgId: string, id: string): Integration {
  const r = one("SELECT * FROM integrations WHERE org_id = ? AND id = ?", orgId, id);
  if (!r) throw notFound("Integration", id);
  return integ(r);
}

/** Lookup without an org: webhooks authenticate by the integration's own secret instead. */
export function findIntegration(id: string): (Integration & { config: Record<string, any> }) | null {
  const r = one("SELECT * FROM integrations WHERE id = ?", id);
  if (!r) return null;
  return { ...integ(r), config: r.config ? JSON.parse(decrypt(r.config)) : {} };
}

export function integrationConfig(orgId: string, id: string): Record<string, any> {
  const r = one("SELECT config FROM integrations WHERE org_id = ? AND id = ?", orgId, id);
  if (!r) throw notFound("Integration", id);
  return r.config ? JSON.parse(decrypt(r.config)) : {};
}

export function updateIntegrationConfig(orgId: string, id: string, patch: Record<string, unknown>) {
  const cfg = { ...integrationConfig(orgId, id), ...patch };
  run("UPDATE integrations SET config = ? WHERE org_id = ? AND id = ?", encrypt(JSON.stringify(cfg)), orgId, id);
}

export function listIntegrations(orgId: string) {
  return q("SELECT * FROM integrations WHERE org_id = ? ORDER BY created_at", orgId).map(integ);
}

export function touchIntegration(id: string) {
  run("UPDATE integrations SET last_event = ?, events = events + 1 WHERE id = ?", now(), id);
}

export function deleteIntegration(orgId: string, id: string) {
  if (!run("DELETE FROM integrations WHERE org_id = ? AND id = ?", orgId, id).changes) throw notFound("Integration", id);
}

/* ------------------------------------------------------------------ */
/* Review queue and ingest ledger                                      */
/* ------------------------------------------------------------------ */

export interface ReviewItem {
  id: string;
  org_id: string;
  status: "pending" | "approved" | "rejected";
  payload: any;
  created_at: number;
  decided_by: string | null;
  decided_at: number | null;
}
const rev = (r: any): ReviewItem => ({ ...r, payload: JSON.parse(r.payload) });

export function createReview(orgId: string, payload: unknown) {
  const id = rid("rev");
  run("INSERT INTO review_items (id, org_id, payload, created_at) VALUES (?,?,?,?)", id, orgId, JSON.stringify(payload), now());
  return getReview(orgId, id);
}
export function getReview(orgId: string, id: string): ReviewItem {
  const r = one("SELECT * FROM review_items WHERE org_id = ? AND id = ?", orgId, id);
  if (!r) throw notFound("Review item", id);
  return rev(r);
}
export function listReviews(orgId: string, status?: string) {
  return q(
    `SELECT * FROM review_items WHERE org_id = ? ${status ? "AND status = ?" : ""} ORDER BY created_at DESC LIMIT 200`,
    ...(status ? [orgId, status] : [orgId]),
  ).map(rev);
}
export function decideReview(orgId: string, id: string, status: "approved" | "rejected", by: string) {
  const r = getReview(orgId, id);
  if (r.status !== "pending") throw conflict(`Already ${r.status}`);
  run("UPDATE review_items SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?", status, by, now(), id);
}
export function pendingReviewCount(orgId: string) {
  return one("SELECT COUNT(*) c FROM review_items WHERE org_id = ? AND status = 'pending'", orgId)!.c as number;
}

export function ingestSeen(orgId: string, kind: string, externalId: string) {
  return !!one("SELECT 1 FROM ingest_log WHERE org_id = ? AND kind = ? AND external_id = ?", orgId, kind, externalId);
}
export function ingestRecord(orgId: string, kind: string, externalId: string, status: string, summary: string) {
  run("INSERT OR REPLACE INTO ingest_log VALUES (?,?,?,?,?,?)", orgId, kind, externalId, status, summary, now());
}
export function ingestRecent(orgId: string, limit = 40) {
  return q("SELECT * FROM ingest_log WHERE org_id = ? ORDER BY created_at DESC LIMIT ?", orgId, limit);
}

export function setIntegrationStatus(orgId: string, id: string, status: Integration["status"]) {
  run("UPDATE integrations SET status = ? WHERE org_id = ? AND id = ?", status, orgId, id);
}
