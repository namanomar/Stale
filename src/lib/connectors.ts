import { StaleError } from "./errors";
import type { IngestDoc } from "./ingest";
import { slackAuthTest, slackBackfill, slackChannels, type SlackConfig } from "./slack";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Pull connectors. Each one knows how to (a) check its credentials, (b) list what can be synced
 * (channels, repos, projects, pages) and (c) turn the chosen scope into IngestDocs.
 * Push connectors (Slack events, email, webhook) live in src/app/api/hooks.
 */
export interface Scope {
  id: string;
  name: string;
  hint?: string;
  /** false when the connector can see it but cannot read it yet (e.g. bot not invited). */
  available?: boolean;
}

export interface PullConnector<C = any> {
  label: string;
  /** What the scope items are called in the UI. */
  scopeNoun: string;
  /** Throws a readable error when the credentials do not work; returns who/what we connected to. */
  test(cfg: C): Promise<string>;
  scopes(cfg: C): Promise<Scope[]>;
  pull(cfg: C, integrationId: string, scope: string[], limit: number): Promise<IngestDoc[]>;
}

async function getJson(url: string, init: RequestInit, what: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new StaleError(502, `${what}: could not reach the service (${e instanceof Error ? e.message : e})`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = json?.message ?? json?.errorMessages?.[0] ?? json?.error ?? text.slice(0, 160) ?? res.statusText;
    throw new StaleError(res.status === 401 || res.status === 403 ? 400 : 502, `${what}: ${res.status} ${msg}`);
  }
  return json;
}

const clip = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) : s);

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

export interface GithubConfig {
  token: string;
}

const gh = (cfg: GithubConfig) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${cfg.token}`,
  "x-github-api-version": "2022-11-28",
  "user-agent": "stale-memory",
});

/** Maintainers and collaborators are the company; everyone else on a public repo is a stranger. */
const ghTrusted = (assoc?: string) => ["OWNER", "MEMBER", "COLLABORATOR"].includes(assoc ?? "");

export const github: PullConnector<GithubConfig> = {
  label: "GitHub",
  scopeNoun: "repositories",
  async test(cfg) {
    const u = await getJson("https://api.github.com/user", { headers: gh(cfg) }, "GitHub");
    return `@${u.login}`;
  },
  async scopes(cfg) {
    const repos = await getJson(
      "https://api.github.com/user/repos?per_page=60&sort=pushed&affiliation=owner,collaborator,organization_member",
      { headers: gh(cfg) },
      "GitHub",
    );
    return repos.map((r: any) => ({
      id: r.full_name,
      name: r.full_name,
      hint: `${r.private ? "private" : "public"} · ${r.open_issues_count} open issues`,
    }));
  },
  async pull(cfg, integrationId, scope, limit) {
    const docs: IngestDoc[] = [];
    for (const repo of scope) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new StaleError(400, `Bad repository name: ${repo}`);
      const issues = await getJson(
        `https://api.github.com/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=${Math.min(limit, 100)}`,
        { headers: gh(cfg) },
        "GitHub",
      );
      for (const i of issues) {
        const kind = i.pull_request ? "PR" : "Issue";
        docs.push({
          kind: "github",
          integrationId,
          externalId: `${repo}#${i.number}:${i.updated_at}`,
          sourceKey: repo,
          sourceName: `GitHub ${repo}`,
          author: i.user?.login,
          url: i.html_url,
          ts: Date.parse(i.updated_at),
          text: clip(`${kind} #${i.number} (${i.state}): ${i.title}\n${i.body ?? ""}\nLabels: ${(i.labels ?? []).map((l: any) => l.name ?? l).join(", ")}`),
          untrusted: !ghTrusted(i.author_association),
        });
      }
      const comments = await getJson(
        `https://api.github.com/repos/${repo}/issues/comments?sort=updated&direction=desc&per_page=${Math.min(limit, 100)}`,
        { headers: gh(cfg) },
        "GitHub",
      );
      for (const c of comments) {
        docs.push({
          kind: "github",
          integrationId,
          externalId: `${repo}/comment/${c.id}:${c.updated_at}`,
          sourceKey: repo,
          sourceName: `GitHub ${repo}`,
          author: c.user?.login,
          url: c.html_url,
          ts: Date.parse(c.updated_at),
          text: clip(c.body ?? ""),
          untrusted: !ghTrusted(c.author_association),
        });
      }
    }
    return docs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  },
};

/* ------------------------------------------------------------------ */
/* Jira                                                                */
/* ------------------------------------------------------------------ */

export interface JiraConfig {
  /** e.g. acme.atlassian.net */
  site: string;
  email: string;
  token: string;
}

const JIRA_HOST = /^[a-z0-9][a-z0-9-]{0,60}\.atlassian\.net$/i;
export const normalizeJiraSite = (s: string) => s.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

const jiraBase = (cfg: JiraConfig) => {
  const site = normalizeJiraSite(cfg.site);
  // The host is user supplied; only real Atlassian Cloud sites are allowed so this cannot be aimed at internal services.
  if (!JIRA_HOST.test(site)) throw new StaleError(400, "Jira site must look like yourcompany.atlassian.net");
  return `https://${site}`;
};
const jiraAuth = (cfg: JiraConfig) => ({
  accept: "application/json",
  authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64")}`,
});

/** Atlassian Document Format to plain text. */
export function adfText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(adfText).join("");
  return ["paragraph", "heading", "listItem", "codeBlock"].includes(node.type) ? inner + "\n" : inner;
}

export const jira: PullConnector<JiraConfig> = {
  label: "Jira",
  scopeNoun: "projects",
  async test(cfg) {
    const me = await getJson(`${jiraBase(cfg)}/rest/api/3/myself`, { headers: jiraAuth(cfg) }, "Jira");
    return me.displayName ?? me.emailAddress ?? "connected";
  },
  async scopes(cfg) {
    const r = await getJson(`${jiraBase(cfg)}/rest/api/3/project/search?maxResults=50`, { headers: jiraAuth(cfg) }, "Jira");
    return (r.values ?? []).map((p: any) => ({ id: p.key, name: `${p.name} (${p.key})`, hint: p.projectTypeKey }));
  },
  async pull(cfg, integrationId, scope, limit) {
    const docs: IngestDoc[] = [];
    const base = jiraBase(cfg);
    for (const key of scope) {
      if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(key)) throw new StaleError(400, `Bad project key: ${key}`);
      const r = await getJson(
        `${base}/rest/api/3/search/jql?` +
          new URLSearchParams({
            jql: `project = ${key} ORDER BY updated DESC`,
            maxResults: String(Math.min(limit, 100)),
            fields: "summary,description,status,reporter,updated,comment,priority",
          }),
        { headers: jiraAuth(cfg) },
        "Jira",
      );
      for (const i of r.issues ?? []) {
        const f = i.fields ?? {};
        docs.push({
          kind: "jira",
          integrationId,
          externalId: `${i.key}:${f.updated}`,
          sourceKey: key,
          sourceName: `Jira ${key}`,
          author: f.reporter?.displayName,
          url: `${base}/browse/${i.key}`,
          ts: Date.parse(f.updated),
          text: clip(`${i.key} (${f.status?.name ?? "unknown status"}): ${f.summary}\n${adfText(f.description)}`),
          // Service-desk customers are outside the company.
          untrusted: f.reporter?.accountType === "customer",
        });
        for (const c of f.comment?.comments ?? []) {
          docs.push({
            kind: "jira",
            integrationId,
            externalId: `${i.key}/comment/${c.id}:${c.updated}`,
            sourceKey: key,
            sourceName: `Jira ${key}`,
            author: c.author?.displayName,
            url: `${base}/browse/${i.key}`,
            ts: Date.parse(c.updated),
            text: clip(`Comment on ${i.key} (${f.summary}): ${adfText(c.body)}`),
            untrusted: c.author?.accountType === "customer",
          });
        }
      }
    }
    return docs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  },
};

/* ------------------------------------------------------------------ */
/* Notion                                                              */
/* ------------------------------------------------------------------ */

export interface NotionConfig {
  token: string;
}

const nt = (cfg: NotionConfig) => ({
  authorization: `Bearer ${cfg.token}`,
  "notion-version": "2022-06-28",
  "content-type": "application/json",
});

const richText = (arr: any[] | undefined) => (arr ?? []).map((t) => t.plain_text ?? "").join("");

function blockText(b: any): string {
  const v = b[b.type];
  if (!v) return "";
  if (b.type === "child_page") return `# ${v.title}`;
  if (b.type === "table_row") return (v.cells ?? []).map((c: any) => richText(c)).join(" | ");
  const t = richText(v.rich_text);
  if (!t) return "";
  if (b.type === "to_do") return `${v.checked ? "[x]" : "[ ]"} ${t}`;
  if (/^heading_/.test(b.type)) return `# ${t}`;
  if (/list_item$/.test(b.type)) return `- ${t}`;
  return t;
}

const pageTitle = (p: any) => {
  const prop = Object.values(p.properties ?? {}).find((x: any) => x.type === "title") as any;
  return richText(prop?.title) || "Untitled";
};

export const notion: PullConnector<NotionConfig> = {
  label: "Notion",
  scopeNoun: "pages",
  async test(cfg) {
    const me = await getJson("https://api.notion.com/v1/users/me", { headers: nt(cfg) }, "Notion");
    return me.name ?? me.bot?.workspace_name ?? "connected";
  },
  async scopes(cfg) {
    const r = await getJson(
      "https://api.notion.com/v1/search",
      {
        method: "POST",
        headers: nt(cfg),
        body: JSON.stringify({ filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 50 }),
      },
      "Notion",
    );
    return (r.results ?? []).map((p: any) => ({ id: p.id, name: pageTitle(p), hint: `edited ${String(p.last_edited_time).slice(0, 10)}` }));
  },
  async pull(cfg, integrationId, scope, limit) {
    const docs: IngestDoc[] = [];
    for (const id of scope) {
      if (!/^[0-9a-f-]{32,36}$/i.test(id)) throw new StaleError(400, `Bad page id: ${id}`);
      const page = await getJson(`https://api.notion.com/v1/pages/${id}`, { headers: nt(cfg) }, "Notion");
      const blocks = await getJson(`https://api.notion.com/v1/blocks/${id}/children?page_size=${Math.min(limit, 100)}`, { headers: nt(cfg) }, "Notion");
      const title = pageTitle(page);
      const body = (blocks.results ?? []).map(blockText).filter(Boolean).join("\n");
      if (!body.trim()) continue;
      docs.push({
        kind: "notion",
        integrationId,
        externalId: `${id}:${page.last_edited_time}`,
        sourceKey: id,
        sourceName: `Notion ${title}`,
        author: page.last_edited_by?.name,
        url: page.url,
        ts: Date.parse(page.last_edited_time),
        text: clip(`${title}\n${body}`),
        untrusted: false,
      });
    }
    return docs;
  },
};

/* ------------------------------------------------------------------ */
/* Slack (history import)                                              */
/* ------------------------------------------------------------------ */

export const slack: PullConnector<SlackConfig> = {
  label: "Slack",
  scopeNoun: "channels",
  async test(cfg) {
    if (!cfg.botToken) throw new StaleError(400, "Add a bot token to this Slack connection to read history");
    return (await slackAuthTest(cfg.botToken)).team;
  },
  async scopes(cfg) {
    return (await slackChannels(cfg)).map((c) => ({
      id: c.id,
      name: `#${c.name}`,
      available: c.member,
      hint: c.member ? undefined : "invite the bot first",
    }));
  },
  async pull(cfg, integrationId, scope, limit) {
    const docs: IngestDoc[] = [];
    for (const ch of scope) docs.push(...(await slackBackfill(cfg, integrationId, ch, limit)));
    return docs;
  },
};

export const PULL: Record<string, PullConnector> = { slack, github, jira, notion };

/* ------------------------------------------------------------------ */
/* Live health check: "connected" must mean a request just succeeded    */
/* ------------------------------------------------------------------ */

export type CheckState = "connected" | "waiting" | "error";
export interface CheckResult {
  state: CheckState;
  detail: string;
  checkedAt: number;
}

/**
 * Pull connectors are checked by calling the service with the stored credentials. Push connectors
 * (Slack events, email, webhook) cannot be called from here, so they are "connected" only once
 * something has actually arrived; until then they are honestly "waiting".
 */
export async function checkIntegration(type: string, cfg: any, events: number): Promise<CheckResult> {
  const at = Date.now();
  const waiting = (what: string): CheckResult => ({ state: "waiting", detail: what, checkedAt: at });
  try {
    if (type === "slack") {
      if (cfg.botToken) {
        const who = await slackAuthTest(cfg.botToken);
        return { state: "connected", detail: `Bot token works (${who.team})`, checkedAt: at };
      }
      return events > 0
        ? { state: "connected", detail: `Receiving events (${events} so far)`, checkedAt: at }
        : waiting("Waiting for the first Slack event. Check the Request URL is verified and the bot is in a channel.");
    }
    if (type === "email" || type === "webhook") {
      return events > 0
        ? { state: "connected", detail: `Received ${events} message${events === 1 ? "" : "s"}`, checkedAt: at }
        : waiting("Ready, but nothing has been sent to it yet.");
    }
    const c = PULL[type];
    if (!c) return waiting("No live check for this connection type.");
    const who = await c.test(cfg);
    return { state: "connected", detail: `Signed in as ${who}`, checkedAt: at };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e), checkedAt: at };
  }
}
