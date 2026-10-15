import { createHmac, timingSafeEqual } from "node:crypto";
import { StaleError } from "./errors";
import { PLANS, type Interval, type PlanId } from "./plans";

/**
 * Razorpay one-time payments (Orders + Checkout) over plain REST, no SDK. A customer pays for a month or a
 * year of a plan; when that runs out the workspace drops back to Free until they pay again.
 * Billing is on only when both keys are set, so self-hosted installs without Razorpay stay unlimited.
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
  if (!res.ok) {
    const why = typeof json?.error === "string" ? json.error : json?.error?.description ?? res.statusText;
    throw new StaleError(502, `Razorpay: ${why}`);
  }
  return json;
}

/** What one payment buys, in paise, for a plan and interval. */
export function priceInPaise(plan: PlanId, interval: Interval): number {
  const def = PLANS[plan];
  const rupees = interval === "yearly" ? def.priceYearly : def.priceMonthly;
  if (!rupees) throw new StaleError(400, `${def.name} cannot be bought online`);
  return rupees * 100;
}

export async function createOrder(opts: { plan: PlanId; interval: Interval; orgId: string }) {
  return call("POST", "/orders", {
    amount: priceInPaise(opts.plan, opts.interval),
    currency: "INR",
    receipt: `${opts.orgId}-${Date.now()}`.slice(0, 40),
    notes: { org_id: opts.orgId, plan: opts.plan, interval: opts.interval },
  });
}

export async function getOrder(orderId: string) {
  return call("GET", `/orders/${encodeURIComponent(orderId)}`);
}

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Checkout success signature: HMAC-SHA256(key_secret, order_id|payment_id). */
export function verifyCheckout(orderId: string, paymentId: string, signature: string) {
  const secret = keySecret();
  if (!secret) return false;
  const want = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(want, signature);
}

/** Webhook signature: HMAC-SHA256(webhook_secret, raw body). */
export function verifyWebhook(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const want = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(want, signature);
}
