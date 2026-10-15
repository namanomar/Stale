"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { jf } from "./api";
import { errText } from "./ui";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", orgName: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  // Previous page if there is one (e.g. the landing page); otherwise the landing page itself.
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await jf("POST", mode === "login" ? "/api/auth/login" : "/api/auth/signup", mode === "login" ? { email: f.email, password: f.password } : f);
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="left">
        <button type="button" className="back" onClick={goBack}>
          <span aria-hidden>←</span> Back
        </button>
        <Link href="/" className="logo" style={{ padding: 0 }}>
          <span className="mark">◆</span> Stale
        </Link>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        <p className="muted" style={{ margin: "0 0 24px" }}>
          {mode === "login" ? "Sign in to your company memory." : "Free to start. Connect your first source in a couple of minutes."}
        </p>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <>
              <div className="field">
                <label htmlFor="name">Your name</label>
                <input id="name" className="input" value={f.name} onChange={set("name")} autoComplete="name" required />
              </div>
              <div className="field">
                <label htmlFor="org">Company or team</label>
                <input id="org" className="input" value={f.orgName} onChange={set("orgName")} autoComplete="organization" required />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" className="input" type="email" value={f.email} onChange={set("email")} autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              className="input"
              type="password"
              value={f.password}
              onChange={set("password")}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
            {mode === "signup" && <span className="help">At least 8 characters.</span>}
          </div>
          {error && (
            <div className="err-text" role="alert" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}
          <button className="btn primary lg" style={{ width: "100%" }} disabled={busy}>
            {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create workspace"}
          </button>
        </form>
        <div className="alt">
          {mode === "login" ? (
            <>
              New here? <Link href="/signup">Create a workspace</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          )}
        </div>
      </div>
      <div className="right">
        <div className="sheet-wrap">
          <div className="sheet-card">
            <div className="muted small" style={{ fontWeight: 700, marginBottom: 6 }}>What Stale does to a line like this</div>
            Acme quotes <s style={{ color: "var(--muted)", textDecorationThickness: 2 }}>$100</s>{" "}
            <b style={{ background: "linear-gradient(transparent 52%, var(--hl) 52%)" }}>$140</b> per unit.
            <div style={{ background: "var(--straw)", padding: "0 8px", marginTop: 4 }}>Hardware will cost about $100,000. <b style={{ color: "var(--stale)" }}>stale</b></div>
          </div>
        </div>
        {[
          ["Learns where work happens", "All your company tools feed one memory. Every fact keeps the words it came from."],
          ["Notices when a fact changes", "Everything built on the old value is flagged, including actions already taken."],
          ["Won’t act on a stranger’s word", "Anything traced to an untrusted sender is stored but blocked from acting."],
        ].map(([t, d]) => (
          <div className="point" key={t}>
            <b>{t}</b>
            <div className="muted" style={{ fontSize: 15 }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
