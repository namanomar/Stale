import { z } from "zod";
import { StaleError } from "@/lib/errors";
import { route } from "@/lib/http";
import { billingEnabled, createSubscription, razorpayKeyId, razorpayPlanId } from "@/lib/razorpay";
import { getBillingRow, saveBilling } from "@/lib/system";

const input = z.object({ plan: z.literal("team"), interval: z.enum(["monthly", "yearly"]) });

/** Step 1 of upgrading: make a Razorpay subscription and hand the browser what Checkout needs. */
export const POST = route(
  async ({ principal, body }) => {
    if (!billingEnabled()) throw new StaleError(503, "Billing is not configured on this server");
    const { plan, interval } = await body(input);
    const planId = razorpayPlanId(plan, interval);
    if (!planId) throw new StaleError(503, `The ${plan} ${interval} plan has not been created in Razorpay yet (run npm run razorpay:setup)`);

    const cur = await getBillingRow(principal.org.id);
    if (cur.status === "active") throw new StaleError(409, "This workspace already has an active subscription. Cancel it first to change plans.");

    const sub = await createSubscription({ planId, interval, orgId: principal.org.id, email: principal.user?.email });
    await saveBilling(principal.org.id, { plan, interval, status: "pending", subscription_id: sub.id });
    return { subscriptionId: sub.id as string, keyId: razorpayKeyId() };
  },
  { min: "admin" },
);
