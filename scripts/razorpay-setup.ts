/**
 * Creates the Team plans (monthly + yearly) in your Razorpay account and appends their ids to .env.
 * Run once per Razorpay account (test and live have separate ids):  npm run razorpay:setup
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createPlan, billingEnabled, razorpayPlanId } from "../src/lib/razorpay";
import type { Interval } from "../src/lib/plans";

if (!billingEnabled()) {
  console.error("Set RAZORPAY_API_KEY and RAZORPAY_SECRET (or RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) in .env first.");
  process.exit(1);
}
async function main() {
  const env = readFileSync(".env", "utf8");
  for (const interval of ["monthly", "yearly"] as Interval[]) {
    const key = `RAZORPAY_PLAN_TEAM_${interval.toUpperCase()}`;
    if (razorpayPlanId("team", interval) || env.includes(`${key}=`)) {
      console.log(`${key} already set, skipping`);
      continue;
    }
    const plan = await createPlan("team", interval);
    appendFileSync(".env", `\n${key}=${plan.id}`);
    console.log(`created ${plan.id} -> ${key} (added to .env)`);
  }
  console.log("Done. Restart the dev server so it picks up the new variables.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
