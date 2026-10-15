"use client";

import Link from "next/link";
import { useState } from "react";

interface Plan {
  name: string;
  blurb: string;
  monthly: number | null;
  cta: string;
  href: string;
  hot?: boolean;
  items: { t: string; no?: boolean }[];
}

const PLANS: Plan[] = [
  {
    name: "Free",
    blurb: "Try it on a real team, no card.",
    monthly: 0,
    cta: "Start free",
    href: "/signup",
    items: [
      { t: "1 workspace, up to 3 people" },
      { t: "500 messages read per month" },
      { t: "2 connectors" },
      { t: "Taint firewall + review queue" },
      { t: "MCP and REST API" },
      { t: "30 days of audit history" },
      { t: "SSO", no: true },
    ],
  },
  {
    name: "Team",
    blurb: "For a team whose decisions depend on shared facts.",
    monthly: 49,
    cta: "Start Team",
    href: "/signup",
    hot: true,
    items: [
      { t: "1 workspace, up to 15 people" },
      { t: "10,000 messages read per month" },
      { t: "All connectors, unlimited" },
      { t: "Everything in Free" },
      { t: "1 year of audit history" },
      { t: "Email support" },
      { t: "SSO", no: true },
    ],
  },
  {
    name: "Enterprise",
    blurb: "Your cloud, your rules, our help.",
    monthly: null,
    cta: "Talk to us",
    href: "mailto:hello@example.com?subject=Stale%20Enterprise",
    items: [
      { t: "Unlimited workspaces and people" },
      { t: "Custom volume" },
      { t: "Self-hosted or private cloud" },
      { t: "SSO, SCIM and audit exports" },
      { t: "Uptime SLA and a named contact" },
      { t: "Security review and DPA" },
    ],
  },
];

export function PricingTable() {
  const [yearly, setYearly] = useState(true);
  return (
    <div>
      <div className="price-bar">
        <div className="price-switch" role="group" aria-label="Billing period">
          <button className={!yearly ? "on" : ""} onClick={() => setYearly(false)}>Monthly</button>
          <button className={yearly ? "on" : ""} onClick={() => setYearly(true)}>Yearly</button>
        </div>
        <span className="price-save">2 months free</span>
      </div>
      <div className="price-grid">
        {PLANS.map((p) => {
          const per = p.monthly === null ? null : yearly ? Math.round((p.monthly * 10) / 12) : p.monthly;
          return (
            <div key={p.name} className={`plan${p.hot ? " hot" : ""}`}>
              <h3>{p.name}</h3>
              <div className="for">{p.blurb}</div>
              <div className="amt">
                {per === null ? "Custom" : `$${per}`}
                {per !== null && per > 0 && <small> / month</small>}
              </div>
              <ul>
                {p.items.map((i) => (
                  <li key={i.t} className={i.no ? "no" : ""}>{i.t}</li>
                ))}
              </ul>
              {p.href.startsWith("/") ? (
                <Link href={p.href} className={`btn${p.hot ? " primary" : ""}`}>{p.cta}</Link>
              ) : (
                <a href={p.href} className="btn">{p.cta}</a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
