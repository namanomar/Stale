import { StaleError } from "./errors";
import { PLANS, type Interval, type PlanDef, type PlanId } from "./plans";
import { billingEnabled, priceInPaise } from "./razorpay";
import { countIntegrations, countMembers, getBillingRow, messagesUsed, recordPayment, saveBilling } from "./system";

/**
 * Which plan is this workspace on right now, and what may it still do?
 * Without Razorpay keys billing is off and nothing is limited (self-hosted installs).
 */
export async function effectivePlan(orgId: string): Promise<PlanDef> {
  if (!billingEnabled()) return PLANS.enterprise;
  const b = await getBillingRow(orgId);
  const paying = b.status === "active" && (b.period_end ?? 0) > Date.now();
  return paying ? PLANS[b.plan as PlanId] : PLANS.free;
}

const over = (what: string, plan: PlanDef, limit: number) =>
  new StaleError(402, `The ${plan.name} plan allows ${limit.toLocaleString("en-IN")} ${what}. Upgrade in Settings → Plan & billing.`, {
    upgrade: "/app/settings",
    plan: plan.id,
  });

export async function assertCanRead(orgId: string) {
  const plan = await effectivePlan(orgId);
  if (plan.messages === null) return;
  if ((await messagesUsed(orgId)) >= plan.messages) throw over("messages read per month", plan, plan.messages);
}

export async function assertCanAddMember(orgId: string) {
  const plan = await effectivePlan(orgId);
  if (plan.members === null) return;
  if ((await countMembers(orgId)) >= plan.members) throw over("people in a workspace", plan, plan.members);
}

export async function assertCanAddConnector(orgId: string) {
  const plan = await effectivePlan(orgId);
  if (plan.connectors === null) return;
  if ((await countIntegrations(orgId)) >= plan.connectors) throw over("connectors", plan, plan.connectors);
}

const DAY = 86_400_000;

/**
 * A paid Razorpay order buys time on a plan. Counted once per order, so the browser callback and the
 * webhook can both report it. Paying again before the period ends adds to the end date.
 */
export async function applyPaidOrder(order: { id: string; amount: number; notes?: Record<string, string> }) {
  const orgId = order.notes?.org_id;
  const plan = order.notes?.plan as PlanId | undefined;
  const interval = order.notes?.interval as Interval | undefined;
  if (!orgId || plan !== "team" || (interval !== "monthly" && interval !== "yearly")) {
    throw new StaleError(400, "This order is not a Stale plan purchase");
  }
  if (order.amount !== priceInPaise(plan, interval)) throw new StaleError(400, "Order amount does not match the plan price");
  if (!(await recordPayment({ orderId: order.id, orgId, plan, interval, amount: order.amount }))) return { applied: false };

  const cur = await getBillingRow(orgId);
  const base = cur.status === "active" && (cur.period_end ?? 0) > Date.now() ? cur.period_end! : Date.now();
  await saveBilling(orgId, { plan, interval, status: "active", period_end: base + (interval === "yearly" ? 365 : 30) * DAY });
  return { applied: true, orgId };
}

export async function billingSummary(orgId: string) {
  const [plan, row, used, members, connectors] = await Promise.all([
    effectivePlan(orgId), getBillingRow(orgId), messagesUsed(orgId), countMembers(orgId), countIntegrations(orgId),
  ]);
  return {
    enabled: billingEnabled(),
    plan: plan.id,
    planName: plan.name,
    status: row.status,
    interval: row.interval,
    periodEnd: row.period_end,
    limits: { messages: plan.messages, members: plan.members, connectors: plan.connectors },
    usage: { messages: used, members, connectors },
  };
}
