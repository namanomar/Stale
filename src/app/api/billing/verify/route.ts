import { z } from "zod";
import { StaleError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getSubscription, verifyCheckout } from "@/lib/razorpay";
import { getBillingRow, saveBilling } from "@/lib/system";

const input = z.object({
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_subscription_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

/** Step 2: Checkout succeeded in the browser. Prove the signature, then switch the plan on. */
export const POST = route(
  async ({ principal, body }) => {
    const b = await body(input);
    const row = await getBillingRow(principal.org.id);
    if (!row.subscription_id || row.subscription_id !== b.razorpay_subscription_id) {
      throw new StaleError(400, "That subscription does not belong to this workspace");
    }
    if (!verifyCheckout(b.razorpay_payment_id, b.razorpay_subscription_id, b.razorpay_signature)) {
      throw new StaleError(400, "Payment signature did not verify");
    }
    const sub = await getSubscription(b.razorpay_subscription_id);
    await saveBilling(principal.org.id, {
      status: "active",
      period_end: sub.current_end ? sub.current_end * 1000 : Date.now() + 31 * 86400_000,
    });
    return { ok: true };
  },
  { min: "admin" },
);
