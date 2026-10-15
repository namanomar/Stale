"use client";

import { ThemeToggle } from "./theme";
import Link from "next/link";
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
          <div className="ws" title="Workspace">
            <span className="av">{me.org.name.slice(0, 1).toUpperCase()}</span>
            <select value={me.org.id} onChange={(e) => switchOrg(e.target.value)} aria-label="Workspace">
              {me.orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
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
