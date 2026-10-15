import { StaleError } from "./errors";
import { PLANS, type PlanDef, type PlanId } from "./plans";
import { billingEnabled } from "./razorpay";
import { countIntegrations, countMembers, getBillingRow, messagesUsed } from "./system";

/**
 * Which plan is this workspace on right now, and what may it still do?
 * Without Razorpay keys billing is off and nothing is limited (self-hosted installs).
 */
export async function effectivePlan(orgId: string): Promise<PlanDef> {
  if (!billingEnabled()) return PLANS.enterprise;
  const b = await getBillingRow(orgId);
  const paying = b.status === "active" || (b.status === "cancelling" && (b.period_end ?? 0) > Date.now());
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
