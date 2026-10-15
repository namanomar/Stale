import type { EdgeRec, GateVerdict, ImpactItem, NodeRec, SourceRec } from "@/lib/types";

export interface Snapshot {
  tenant: string;
  nodes: NodeRec[];
  sources: SourceRec[];
  edges: EdgeRec[];
  tainted: string[];
  stats: {
    nodes: number;
    sources: number;
    valid: number;
    stale: number;
    superseded: number;
    tainted: number;
    blockedActions: number;
    executedActions: number;
  };
}

export interface PlanNode extends NodeRec {
  rebase: { from: string; fromContent: string; to: string | null; toContent: string | null }[];
}
export interface RepairPlan {
  total: number;
  executedActionsAtRisk: number;
  layers: { layer: number; nodes: PlanNode[] }[];
}
export interface EventRec {
  id: string;
  type: string;
  node_id: string;
  ts: number;
  payload: Record<string, unknown>;
}
export type { GateVerdict, ImpactItem };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

/** Plain JSON fetch against our own API. The session cookie carries identity and workspace. */
export async function jf<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
      window.location.href = "/login";
    }
    throw new ApiError(res.status, json.error ?? res.statusText, json.details);
  }
  return json as T;
}

export interface Totals {
  read: number;
  added: number;
  updated: number;
  confirmed: number;
  queued: number;
  skipped: number;
  failed: number;
}
export type SyncEvent =
  | { t: "stage"; text: string }
  | { t: "total"; total: number }
  | { t: "item"; done: number; total: number; label: string; outcome: string; totals: Totals }
  | { t: "done"; totals: Totals }
  | { t: "error"; message: string };

/** POST that answers with newline-delimited JSON events; calls onEvent for each as it arrives. */
export async function streamPost(path: string, body: unknown, onEvent: (e: SyncEvent) => void, signal?: AbortSignal) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
    signal,
  });
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(res.status, json.error ?? res.statusText, json.details);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as SyncEvent);
    }
  }
}

export function makeApi() {
  const req = <T,>(method: string, path: string, body?: unknown) => jf<T>(method, `/api/v1${path}`, body);
  const enc = encodeURIComponent;
  return {
    graph: () => req<Snapshot>("GET", "/graph"),
    plan: () => req<RepairPlan>("GET", "/repair-plan"),
    events: (limit = 60) => req<EventRec[]>("GET", `/events?limit=${limit}`),
    seed: () => req<Snapshot>("POST", "/demo/seed"),
    reset: () => req<{ reset: string }>("DELETE", "/tenant"),
    impact: (id: string) => req<{ count: number; impacted: ImpactItem[] }>("GET", `/nodes/${enc(id)}/impact`),
    supersede: (id: string, content: string, reason?: string) =>
      req<{ impacted: ImpactItem[]; node: NodeRec; executedActionsAtRisk: ImpactItem[] }>(
        "POST",
        `/nodes/${enc(id)}/supersede`,
        { content, reason },
      ),
    resolve: (id: string, content?: string) =>
      req<{ node: NodeRec; rebased: unknown[] }>("POST", `/nodes/${enc(id)}/resolve`, { content }),
    check: (id: string) => req<GateVerdict>("GET", `/actions/${enc(id)}/check`),
    approve: (id: string, approver: string, note?: string) =>
      req<NodeRec>("POST", `/actions/${enc(id)}/approve`, { approver, note }),
    execute: (id: string) => req<{ node: NodeRec }>("POST", `/actions/${enc(id)}/execute`),
    trust: (id: string, trust: "trusted" | "untrusted", reason?: string) =>
      req<{ affected: ImpactItem[]; executedActions: ImpactItem[]; blockedActions: ImpactItem[] }>(
        "POST",
        `/sources/${enc(id)}/trust`,
        { trust, reason },
      ),
  };
}
export type Api = ReturnType<typeof makeApi>;

export interface Me {
  user: { id: string; name: string; email: string } | null;
  org: { id: string; name: string; settings: { autoApply: "trusted" | "never" } };
  role: "viewer" | "member" | "admin";
  orgs: { id: string; name: string; role: string }[];
  pendingReviews: number;
}

export interface IngestResult {
  status: "processed" | "duplicate" | "empty";
  engine: "llm" | "rules";
  claims: number;
  added: { id: string; statement: string; tainted: boolean }[];
  confirmed: { id: string; statement: string }[];
  updated: { id: string; previousId: string; statement: string; previous: string; impacted: number; actionsAtRisk: number }[];
  queued: { reviewId: string; statement: string; reason: string }[];
}

export interface ReviewItem {
  id: string;
  status: "pending" | "approved" | "rejected";
  created_at: number;
  decided_by: string | null;
  decided_at: number | null;
  payload: {
    op: "add" | "supersede";
    statement: string;
    sourceName: string;
    untrusted: boolean;
    confidence: number;
    targetId?: string;
    targetContent?: string;
    reason: string;
    risk: "untrusted-source" | "low-confidence" | "possible-conflict" | "policy";
    evidence: { quote: string; author?: string; url?: string; ts?: number; source: string };
  };
}

export interface IntegrationRec {
  id: string;
  type: "slack" | "webhook" | "email" | "upload" | "github" | "drive" | "jira" | "notion";
  name: string;
  status: string;
  created_at: number;
  last_event: number | null;
  events: number;
  webhookUrl?: string;
  syncable?: boolean;
  secret?: string;
}
