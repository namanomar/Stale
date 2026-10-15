import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { DocPager, DocSidebar } from "@/components/docs/DocSidebar";
import "./docs.css";

export const metadata = {
  title: "Docs · Stale",
  description: "How Stale works: concepts, architecture, MCP tools, REST API, connectors, security and pricing.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dx">
      <header className="dx-top">
        <Link href="/" className="logo">
          <span className="mark">◆</span>
          <span className="t">Stale</span>
        </Link>
        <span className="dx-badge">Docs</span>
        <div className="sp">
          <Link className="plain" href="/docs/pricing">Pricing</Link>
          <ThemeToggle />
          <Link className="btn primary sm" href="/signup">Create workspace</Link>
        </div>
      </header>
      <div className="dx-body">
        <DocSidebar />
        <main className="dx-main">
          {children}
          <DocPager />
        </main>
      </div>
    </div>
  );
}
