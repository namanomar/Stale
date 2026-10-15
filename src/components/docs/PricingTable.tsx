"use client";

import Link from "next/link";
import { useState } from "react";
import { inr, PLANS, perMonth, type Interval, type PlanId } from "@/lib/plans";

const FEATURES: Record<PlanId, { t: string; no?: boolean }[]> = {
  free: [
    { t: "1 workspace" },
    { t: "Up to 3 people" },
    { t: "500 messages read per month" },
    { t: "2 connectors" },
    { t: "Taint firewall + review queue" },
    { t: "MCP and REST API" },
    { t: "SSO", no: true },
  ],
  team: [
    { t: "1 workspace" },
    { t: "Up to 15 people" },
    { t: "10,000 messages read per month" },
    { t: "Unlimited connectors" },
    { t: "Everything in Free" },
    { t: "Email support" },
    { t: "SSO", no: true },
  ],
  enterprise: [
    { t: "Unlimited people and messages" },
    { t: "Self-hosted or private cloud" },
    { t: "SSO, SCIM and audit exports" },
    { t: "Uptime SLA and a named contact" },
    { t: "Security review and DPA" },
  ],
};

const ORDER: PlanId[] = ["free", "team", "enterprise"];

export function PricingTable() {
  const [interval, setInterval] = useState<Interval>("yearly");
  return (
    <div>
      <div className="price-bar">
        <div className="price-switch" role="group" aria-label="Billing period">
          <button className={interval === "monthly" ? "on" : ""} onClick={() => setInterval("monthly")}>Monthly</button>
          <button className={interval === "yearly" ? "on" : ""} onClick={() => setInterval("yearly")}>Yearly</button>
        </div>
        <span className="price-save">2 months free</span>
      </div>
      <div className="price-grid">
        {ORDER.map((id) => {
          const p = PLANS[id];
          const per = perMonth(p, interval);
          const hot = id === "team";
          return (
            <div key={id} className={`plan${hot ? " hot" : ""}`}>
              <h3>{p.name}</h3>
              <div className="for">{p.blurb}</div>
              <div className="amt">
                {per === null ? "Custom" : inr(per)}
                {per !== null && per > 0 && <small> / month</small>}
              </div>
              <ul>
                {FEATURES[id].map((i) => (
                  <li key={i.t} className={i.no ? "no" : ""}>{i.t}</li>
                ))}
              </ul>
              {id === "enterprise" ? (
                <a href="mailto:hello@example.com?subject=Stale%20Enterprise" className="btn">Talk to us</a>
              ) : (
                <Link href="/signup" className={`btn${hot ? " primary" : ""}`}>{id === "free" ? "Start free" : "Start Team"}</Link>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">Prices in Indian rupees, paid through Razorpay (UPI, cards, netbanking). One payment buys a month or a year; there is no automatic renewal.</p>
    </div>
  );
}
