"use client";

import { useEffect, useState } from "react";
import { jf, type Me } from "../api";
import { CopyBlock, errText, Field, Modal, PageHead, timeAgo, useLoad, useToast } from "../ui";

type Tab = "general" | "members" | "keys" | "agent";

function General({ me, reload }: { me: Me; reload: () => void }) {
  const toast = useToast();
  const admin = me.role === "admin";
  const [name, setName] = useState(me.org.name);
  const [policy, setPolicy] = useState(me.org.settings.autoApply);
  useEffect(() => {
    setName(me.org.name);
    setPolicy(me.org.settings.autoApply);
  }, [me.org.name, me.org.settings.autoApply]);

  async function save() {
    try {
      await jf("PATCH", "/api/workspace", { name, settings: { autoApply: policy } });
      toast("ok", "Saved");
      reload();
    } catch (e) {
      toast("err", errText(e));
    }
  }
  return (
    <div className="box" style={{ maxWidth: 640 }}>
      <Field label="Workspace name">
        <input className="input" value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="When knowledge changes" help="Applies to claims extracted from connected sources. Untrusted sources always require review before they can overwrite anything.">
        <label className="row" style={{ alignItems: "flex-start", padding: "6px 0" }}>
          <input type="radio" checked={policy === "trusted"} disabled={!admin} onChange={() => setPolicy("trusted")} style={{ marginTop: 4 }} />
          <span>
            <b>Apply automatically</b> when the source is trusted and the model is confident.
            <br />
            <span className="muted small">Fastest. Everything is still logged and reversible by a new update.</span>
          </span>
        </label>
        <label className="row" style={{ alignItems: "flex-start", padding: "6px 0" }}>
          <input type="radio" checked={policy === "never"} disabled={!admin} onChange={() => setPolicy("never")} style={{ marginTop: 4 }} />
          <span>
            <b>Always ask a human first</b>
            <br />
            <span className="muted small">Every extracted fact goes through the review queue.</span>
          </span>
        </label>
      </Field>
      <button className="btn primary" disabled={!admin} onClick={save}>Save changes</button>
      {!admin && <div className="muted small" style={{ marginTop: 8 }}>Only admins can change these settings.</div>}
    </div>
  );
}

interface Member { id: string; name: string; email: string; role: string }

function Members({ me }: { me: Me }) {
  const toast = useToast();
  const admin = me.role === "admin";
  const { data, reload } = useLoad<Member[]>(() => jf("GET", "/api/workspace/members"));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  async function invite() {
    try {
      await jf("POST", "/api/workspace/members", { email, role });
      setEmail("");
      toast("ok", "Added to the workspace");
      reload();
    } catch (e) {
      toast("err", errText(e));
    }
  }
  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name} from this workspace?`)) return;
    try {
      await jf("DELETE", `/api/workspace/members?userId=${encodeURIComponent(m.id)}`);
      reload();
    } catch (e) {
      toast("err", errText(e));
    }
  }
  return (
    <div className="box">
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
        <tbody>
          {(data ?? []).map((m) => (
            <tr key={m.id}>
              <td><b>{m.name}</b>{m.id === me.user?.id && <span className="muted"> (you)</span>}</td>
              <td className="muted">{m.email}</td>
              <td><span className="badge-soft">{m.role}</span></td>
              <td style={{ textAlign: "right" }}>{admin && m.id !== me.user?.id && <button className="btn sm danger" onClick={() => remove(m)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {admin && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <h3>Add a teammate</h3>
          <div className="row">
            <input className="input" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="select" style={{ width: 150 }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="viewer">Viewer</option>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn primary" disabled={!email.includes("@")} onClick={invite}>Add</button>
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>They need to have created an account first. Email invitations arrive with SSO.</div>
          <div className="muted small" style={{ marginTop: 4 }}><b>Viewer</b> reads · <b>Member</b> writes and reviews · <b>Admin</b> manages connections, keys and people.</div>
        </div>
      )}
    </div>
  );
}

interface Key { id: string; name: string; prefix: string; created_at: number; last_used: number | null }

function Keys({ me }: { me: Me }) {
  const toast = useToast();
  const admin = me.role === "admin";
  const { data, reload } = useLoad<Key[]>(() => (admin ? jf("GET", "/api/workspace/keys") : Promise.resolve([])));
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  async function create() {
    try {
      const k = await jf<{ secret: string }>("POST", "/api/workspace/keys", { name });
      setSecret(k.secret);
      setName("");
      reload();
    } catch (e) {
      toast("err", errText(e));
    }
  }
  async function revoke(k: Key) {
    if (!confirm(`Revoke “${k.name}”? Agents using it stop working immediately.`)) return;
    try {
      await jf("DELETE", `/api/workspace/keys?id=${encodeURIComponent(k.id)}`);
      reload();
    } catch (e) {
      toast("err", errText(e));
    }
  }
  if (!admin) return <div className="callout">Only admins can manage API keys.</div>;
  return (
    <div className="box">
      <div className="row" style={{ marginBottom: 14 }}>
        <input className="input" placeholder="Key name, e.g. support-agent" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn primary" disabled={!name.trim()} onClick={create}>Create key</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr></thead>
        <tbody>
          {(data ?? []).map((k) => (
            <tr key={k.id}>
              <td><b>{k.name}</b></td>
              <td className="mono muted">{k.prefix}…</td>
              <td className="muted">{timeAgo(k.created_at)}</td>
              <td className="muted">{timeAgo(k.last_used)}</td>
              <td style={{ textAlign: "right" }}><button className="btn sm danger" onClick={() => revoke(k)}>Revoke</button></td>
            </tr>
          ))}
          {data?.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 24, textAlign: "center" }}>No keys yet.</td></tr>}
        </tbody>
      </table>
      {secret && (
        <Modal title="Your new API key" sub="Copy it now. For security it is never shown again." onClose={() => setSecret(null)} foot={<button className="btn primary" onClick={() => setSecret(null)}>I’ve copied it</button>}>
          <CopyBlock text={secret} />
        </Modal>
      )}
    </div>
  );
}

function Agent() {
  const [origin, setOrigin] = useState("https://your-host");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <div className="grid" style={{ gap: 14, maxWidth: 820 }}>
      <div className="box">
        <h3>Connect an agent over MCP</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Any MCP-capable agent gets tools to remember facts with sources, explain answers, check actions against the firewall and repair stale knowledge. Create a key under <b>API keys</b> and use it as the bearer token.
        </p>
        <CopyBlock label="Claude Code" text={`claude mcp add --transport http stale ${origin}/api/mcp --header "Authorization: Bearer sk_YOUR_KEY"`} />
        <div style={{ height: 12 }} />
        <CopyBlock
          label="Other clients (JSON)"
          text={JSON.stringify({ mcpServers: { stale: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: "Bearer sk_YOUR_KEY" } } } }, null, 2)}
        />
      </div>
      <div className="box">
        <h3>Or use the REST API</h3>
        <CopyBlock text={`curl ${origin}/api/v1/ingest \\\n  -H "Authorization: Bearer sk_YOUR_KEY" -H "content-type: application/json" \\\n  -d '{"kind":"manual","source":"Pricing sheet","text":"Support SLA is 4 hours for premium customers."}'`} />
        <div className="callout" style={{ marginTop: 12 }}>
          Agents can never approve their own blocked actions. Overrides are a human decision made in the app.
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>("general");
  const { data: me, reload } = useLoad<Me>(() => jf("GET", "/api/auth/me"));
  return (
    <div className="page">
      <PageHead title="Settings" sub={me ? `${me.org.name} · you are ${me.role === "admin" ? "an admin" : `a ${me.role}`}` : undefined} />
      <div className="tabsbar">
        {([["general", "General"], ["members", "Members"], ["keys", "API keys"], ["agent", "Connect an agent"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {me && tab === "general" && <General me={me} reload={reload} />}
      {me && tab === "members" && <Members me={me} />}
      {me && tab === "keys" && <Keys me={me} />}
      {tab === "agent" && <Agent />}
    </div>
  );
}
