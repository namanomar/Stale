"use client";

import { ThemeToggle } from "./theme";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { jf, type Me } from "./api";
import { ToastProvider, useLoad } from "./ui";

const NAV: { href: string; label: string; ico: string; section?: string; badge?: "review" }[] = [
  { href: "/app", label: "Overview", ico: "◩", section: "Workspace" },
  { href: "/app/memory", label: "Memory", ico: "◈" },
  { href: "/app/review", label: "Review queue", ico: "✓", badge: "review" },
  { href: "/app/integrations", label: "Integrations", ico: "⇄", section: "Connect" },
  { href: "/app/activity", label: "Activity", ico: "≡" },
  { href: "/app/settings", label: "Settings", ico: "⚙", section: "Admin" },
];

export default function Shell({ initial, children }: { initial: Me; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data } = useLoad(() => jf<Me>("GET", "/api/auth/me"), 8000);
  const me = data ?? initial;
  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  const flush = path.startsWith("/app/memory");

  async function signOut() {
    await jf("POST", "/api/auth/logout", {});
    router.push("/login");
    router.refresh();
  }
  async function switchOrg(orgId: string) {
    await jf("POST", "/api/auth/me", { orgId });
    router.refresh();
    window.location.reload();
  }

  return (
    <ToastProvider>
      <div className="shell">
        <aside className="sidebar">
          <div className="logo">
            <span className="mark">◆</span>
            <span className="t">Stale</span>
          </div>
          <WorkspaceMenu me={me} onSwitch={switchOrg} />
          <nav className="nav">
            {NAV.map((n) => (
              <div key={n.href} style={{ display: "contents" }}>
                {n.section && <div className="section">{n.section}</div>}
                <Link href={n.href} className={active(n.href) ? "on" : ""}>
                  <span className="ico">{n.ico}</span>
                  {n.label}
                  {n.badge === "review" && me.pendingReviews > 0 && <span className="count">{me.pendingReviews}</span>}
                </Link>
              </div>
            ))}
          </nav>
          <div className="userbox">
            <span className="av">{(me.user?.name ?? "?").slice(0, 1).toUpperCase()}</span>
            <div className="who">
              <b>{me.user?.name}</b>
              <span>
                {me.role} · {me.user?.email}
              </span>
            </div>
            <ThemeToggle />
            <button className="btn sm ghost" onClick={signOut} title="Sign out">
              Sign out
            </button>
          </div>
        </aside>
        <main className={`content ${flush ? "flush" : ""}`}>{children}</main>
      </div>
    </ToastProvider>
  );
}

/** The workspace picker: a styled menu instead of the browser's native select list. */
function WorkspaceMenu({ me, onSwitch }: { me: Me; onSwitch: (orgId: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const many = me.orgs.length > 1;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="ws-wrap" ref={box}>
      <button
        type="button"
        className={`ws${open ? " open" : ""}`}
        onClick={() => many && setOpen((o) => !o)}
        aria-haspopup={many ? "listbox" : undefined}
        aria-expanded={many ? open : undefined}
        aria-label="Workspace"
        disabled={!many}
      >
        <span className="av">{me.org.name.slice(0, 1).toUpperCase()}</span>
        <span className="ws-name">
          <b>{me.org.name}</b>
          <small>{me.role}</small>
        </span>
        {many && <span className="chev" aria-hidden>▾</span>}
      </button>
      {open && (
        <div className="ws-menu" role="listbox" aria-label="Switch workspace">
          <div className="ws-menu-l">Switch workspace</div>
          {me.orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === me.org.id}
              className={o.id === me.org.id ? "on" : ""}
              onClick={() => (o.id === me.org.id ? setOpen(false) : onSwitch(o.id))}
            >
              <span className="av">{o.name.slice(0, 1).toUpperCase()}</span>
              <span className="ws-name">
                <b>{o.name}</b>
                <small>{o.role}</small>
              </span>
              {o.id === me.org.id && <span className="tick" aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
