import { StaleError } from "@/lib/errors";
import { plain } from "@/lib/http";
import { verifyWebhook } from "@/lib/razorpay";
import { findBillingBySubscription, saveBilling } from "@/lib/system";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Razorpay tells us about renewals, failures and cancellations here. Set the URL in the Razorpay
 * dashboard (Settings → Webhooks) and use the same secret as RAZORPAY_WEBHOOK_SECRET.
 * Events: subscription.activated, .charged, .cancelled, .completed, .halted.
 */
export const POST = plain(async (req) => {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-razorpay-signature") ?? "")) throw new StaleError(401, "Bad signature");

  const evt = JSON.parse(raw) as { event: string; payload?: { subscription?: { entity?: any } } };
  const sub = evt.payload?.subscription?.entity;
  if (!sub?.id) return { ok: true, ignored: true };
  const row = await findBillingBySubscription(sub.id);
  if (!row) return { ok: true, ignored: true };

  const periodEnd = sub.current_end ? sub.current_end * 1000 : row.period_end;
  switch (evt.event) {
    case "subscription.activated":
    case "subscription.charged":
      await saveBilling(row.org_id, { status: row.status === "cancelling" ? "cancelling" : "active", period_end: periodEnd });
      break;
    case "subscription.cancelled":
    case "subscription.completed":
      await saveBilling(row.org_id, { status: (row.period_end ?? 0) > Date.now() ? "cancelling" : "ended" });
      break;
    case "subscription.halted": // repeated payment failures: stop the paid plan now
      await saveBilling(row.org_id, { status: "ended" });
      break;
  }
  return { ok: true };
});
