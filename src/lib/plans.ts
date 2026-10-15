/**
 * Plans: the single source of truth for what each tier includes and costs.
 * Used by the pricing page, the billing screen and the limit checks, so they can never disagree.
 * `null` means unlimited. Prices are in INR rupees (Razorpay takes paise; multiply by 100).
 */
export type PlanId = "free" | "team" | "enterprise";

export interface PlanDef {
  id: PlanId;
  name: string;
  blurb: string;
  /** Messages read (claim extraction runs) per calendar month. */
  messages: number | null;
  members: number | null;
  connectors: number | null;
  /** Rupees per month when billed monthly / per year when billed yearly. null = not self-serve. */
  priceMonthly: number | null;
  priceYearly: number | null;
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    blurb: "Try it on a real team, no card.",
    messages: 500,
    members: 3,
    connectors: 2,
    priceMonthly: 0,
    priceYearly: 0,
  },
  team: {
    id: "team",
    name: "Team",
    blurb: "For a team whose decisions depend on shared facts.",
    messages: 10000,
    members: 15,
    connectors: null,
    priceMonthly: 3999,
    priceYearly: 39990, // two months free
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    blurb: "Your cloud, your rules, our help.",
    messages: null,
    members: null,
    connectors: null,
    priceMonthly: null,
    priceYearly: null,
  },
};

export type Interval = "monthly" | "yearly";

export const isPlanId = (s: unknown): s is PlanId => s === "free" || s === "team" || s === "enterprise";

/** Rupees per month shown on the page for an interval. */
export function perMonth(plan: PlanDef, interval: Interval): number | null {
  if (plan.priceMonthly === null) return null;
  return interval === "yearly" ? Math.round((plan.priceYearly ?? plan.priceMonthly * 12) / 12) : plan.priceMonthly;
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
