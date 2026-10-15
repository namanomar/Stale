"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_GROUPS, FLAT_LINKS } from "./nav";

export function DocSidebar() {
  const path = usePathname();
  return (
    <nav className="dx-side" aria-label="Documentation">
      {DOC_GROUPS.map((g) => (
        <div key={g.label} className="dx-grp">
          <div className="dx-grp-l">{g.label}</div>
          {g.links.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "on" : ""} aria-current={path === l.href ? "page" : undefined}>
              {l.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function DocPager() {
  const path = usePathname();
  const i = FLAT_LINKS.findIndex((l) => l.href === path);
  if (i < 0) return null;
  const prev = FLAT_LINKS[i - 1];
  const next = FLAT_LINKS[i + 1];
  return (
    <div className="dx-pager">
      {prev ? (
        <Link href={prev.href} className="prev">
          <small>Previous</small>
          <b>{prev.title}</b>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="next">
          <small>Next</small>
          <b>{next.title}</b>
        </Link>
      )}
    </div>
  );
}
