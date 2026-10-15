import { createHmac, timingSafeEqual } from "node:crypto";
import { StaleError } from "./errors";
import { PLANS, type Interval, type PlanId } from "./plans";

/**
 * Razorpay Subscriptions over plain REST (no SDK). Billing is switched on only when both keys are set,
 * so self-hosted installs without Razorpay stay unlimited.
 */
const API = "https://api.razorpay.com/v1";

/** Accepts RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (Razorpay's own names) or RAZORPAY_API_KEY / RAZORPAY_SECRET. */
export const razorpayKeyId = () => process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_API_KEY || "";
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || "";
export const billingEnabled = () => !!razorpayKeyId() && !!keySecret();

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(method: string, path: string, body?: unknown): Promise<any> {
  if (!billingEnabled()) throw new StaleError(503, "Billing is not configured on this server");
  const auth = Buffer.from(`${razorpayKeyId()}:${keySecret()}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new StaleError(502, `Razorpay: ${json?.error?.description ?? res.statusText}`);
  return json;
}

/** The Razorpay plan id for a plan and interval, taken from env (created by `npm run razorpay:setup`). */
export function razorpayPlanId(plan: PlanId, interval: Interval): string | undefined {
  const key = `RAZORPAY_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  return process.env[key] || undefined;
}

export async function createPlan(plan: PlanId, interval: Interval) {
  const def = PLANS[plan];
  const rupees = interval === "yearly" ? def.priceYearly : def.priceMonthly;
  if (!rupees) throw new Error(`${plan} has no ${interval} price`);
  return call("POST", "/plans", {
    period: interval === "yearly" ? "yearly" : "monthly",
    interval: 1,
    item: { name: `Stale ${def.name} (${interval})`, amount: rupees * 100, currency: "INR", description: def.blurb },
  });
}

export async function createSubscription(opts: { planId: string; interval: Interval; orgId: string; email?: string }) {
  return call("POST", "/subscriptions", {
    plan_id: opts.planId,
    // Razorpay needs a bounded count: 10 years either way.
    total_count: opts.interval === "yearly" ? 10 : 120,
    customer_notify: 1,
    notes: { org_id: opts.orgId, ...(opts.email ? { email: opts.email } : {}) },
  });
}

export async function getSubscription(subscriptionId: string) {
  return call("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export async function cancelSubscription(subscriptionId: string, atCycleEnd = true) {
  return call("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
}

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Checkout success signature: HMAC-SHA256(key_secret, payment_id|subscription_id). */
export function verifyCheckout(paymentId: string, subscriptionId: string, signature: string) {
  const secret = keySecret();
  if (!secret) return false;
  const want = createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  return safeEqualHex(want, signature);
}

/** Webhook signature: HMAC-SHA256(webhook_secret, raw body). */
export function verifyWebhook(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const want = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(want, signature);
}
