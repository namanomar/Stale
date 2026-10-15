import { z } from "zod";
import { StaleError } from "@/lib/errors";
import { route } from "@/lib/http";
import { billingEnabled, createOrder, razorpayKeyId } from "@/lib/razorpay";

const input = z.object({ plan: z.literal("team"), interval: z.enum(["monthly", "yearly"]) });

/** Step 1: create a Razorpay order for a month or a year of Team and hand the browser what Checkout needs. */
export const POST = route(
  async ({ principal, body }) => {
    if (!billingEnabled()) throw new StaleError(503, "Billing is not configured on this server");
    const { plan, interval } = await body(input);
    const order = await createOrder({ plan, interval, orgId: principal.org.id });
    return { orderId: order.id as string, amount: order.amount as number, keyId: razorpayKeyId() };
  },
  { min: "admin" },
);
