import { z } from "zod";
import { applyPaidOrder } from "@/lib/billing";
import { StaleError } from "@/lib/errors";
import { route } from "@/lib/http";
import { getOrder, verifyCheckout } from "@/lib/razorpay";

const input = z.object({
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

/** Step 2: Checkout succeeded in the browser. Prove the signature, confirm the order is paid, extend the plan. */
export const POST = route(
  async ({ principal, body }) => {
    const b = await body(input);
    if (!verifyCheckout(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
      throw new StaleError(400, "Payment signature did not verify");
    }
    const order = await getOrder(b.razorpay_order_id);
    if (order.notes?.org_id !== principal.org.id) throw new StaleError(400, "That order belongs to a different workspace");
    if (order.status !== "paid") throw new StaleError(409, "Razorpay has not marked this order as paid yet");
    await applyPaidOrder(order);
    return { ok: true };
  },
  { min: "admin" },
);
