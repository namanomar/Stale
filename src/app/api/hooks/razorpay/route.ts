import { applyPaidOrder } from "@/lib/billing";
import { StaleError } from "@/lib/errors";
import { plain } from "@/lib/http";
import { verifyWebhook } from "@/lib/razorpay";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Backup for the browser callback: if someone pays and closes the tab before Stale hears back, Razorpay
 * still tells us here. Set the URL in the Razorpay dashboard (Settings → Webhooks), tick `order.paid`,
 * and use the same secret as RAZORPAY_WEBHOOK_SECRET. Counting is idempotent per order.
 */
export const POST = plain(async (req) => {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-razorpay-signature") ?? "")) throw new StaleError(401, "Bad signature");

  const evt = JSON.parse(raw) as { event: string; payload?: { order?: { entity?: any } } };
  const order = evt.payload?.order?.entity;
  if (evt.event !== "order.paid" || !order?.id) return { ok: true, ignored: true };
  if (!order.notes?.org_id) return { ok: true, ignored: true }; // not one of ours
  return { ok: true, ...(await applyPaidOrder(order)) };
});
