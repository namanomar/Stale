import { StaleError } from "@/lib/errors";
import { route } from "@/lib/http";
import { cancelSubscription } from "@/lib/razorpay";
import { getBillingRow, saveBilling } from "@/lib/system";

/** Stop renewing. The paid plan stays on until the end of the period already paid for. */
export const POST = route(
  async ({ principal }) => {
    const row = await getBillingRow(principal.org.id);
    if (row.status !== "active" || !row.subscription_id) throw new StaleError(409, "There is no active subscription to cancel");
    await cancelSubscription(row.subscription_id, true);
    await saveBilling(principal.org.id, { status: "cancelling" });
    return { ok: true, until: row.period_end };
  },
  { min: "admin" },
);
