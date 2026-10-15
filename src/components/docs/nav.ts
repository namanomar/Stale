export interface DocLink {
  href: string;
  title: string;
  blurb: string;
}

export const DOC_GROUPS: { label: string; links: DocLink[] }[] = [
  {
    label: "Start here",
    links: [
      { href: "/docs", title: "Overview", blurb: "What Stale is, and a five minute tour." },
      { href: "/docs/concepts", title: "Core ideas", blurb: "Facts, beliefs, staleness, taint and the firewall." },
    ],
  },
  {
    label: "Under the hood",
    links: [
      { href: "/docs/architecture", title: "Architecture", blurb: "How a message becomes a flagged decision." },
      { href: "/docs/connectors", title: "Connectors", blurb: "Slack, GitHub, Jira, Notion, email, webhooks." },
      { href: "/docs/security", title: "Security & trust", blurb: "Roles, keys, encryption, the taint firewall." },
    ],
  },
  {
    label: "Build with Stale",
    links: [
      { href: "/docs/mcp", title: "MCP tools", blurb: "Every tool an agent gets, with examples." },
      { href: "/docs/api", title: "REST API", blurb: "Every endpoint, role and payload." },
      { href: "/docs/self-host", title: "Self-hosting", blurb: "Run it yourself on Vercel, Railway or Docker." },
    ],
  },
  {
    label: "Plans",
    links: [{ href: "/docs/pricing", title: "Pricing", blurb: "Free to start, pay when your team does." }],
  },
];

export const FLAT_LINKS = DOC_GROUPS.flatMap((g) => g.links);
