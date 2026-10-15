process.env.STALE_DB = ":memory:";
process.env.RAZORPAY_API_KEY = "rzp_test_dummy";
process.env.RAZORPAY_SECRET = "dummy_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_dummy";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, describe, it } from "node:test";
import { applyPaidOrder, assertCanAddConnector, assertCanAddMember, assertCanRead, billingSummary, effectivePlan } from "../src/lib/billing";
import { billingEnabled, priceInPaise, verifyCheckout, verifyWebhook } from "../src/lib/razorpay";
import { addMemberByEmail, addMessages, closeSys, createAccount, createIntegration, getBillingRow, saveBilling } from "../src/lib/system";

after(() => closeSys());

const DAY = 86_400_000;
const newOrg = async (tag: string) => (await createAccount({ name: tag, email: `${tag}@x.test`, password: "password-123", orgName: tag })).org.id;
const order = (id: string, orgId: string, interval: "monthly" | "yearly", amount = priceInPaise("team", interval)) => ({
  id, amount, notes: { org_id: orgId, plan: "team", interval },
});

describe("plans and limits", () => {
  it("a new workspace is on Free", async () => {
    const org = await newOrg("free1");
    assert.equal((await effectivePlan(org)).id, "free");
  });

  it("Free caps connectors at 2", async () => {
    const org = await newOrg("free2");
    await createIntegration(org, "webhook", "a", {});
    await createIntegration(org, "webhook", "b", {});
    await assert.rejects(() => assertCanAddConnector(org), /2 connectors/);
  });

  it("Free caps people at 3 (the creator counts)", async () => {
    const org = await newOrg("free3");
    await assertCanAddMember(org); // 1 of 3
    for (const n of ["m1", "m2"]) {
      await createAccount({ name: n, email: `${n}-${org}@x.test`, password: "password-123", orgName: n });
      await addMemberByEmail(org, `${n}-${org}@x.test`, "member");
    }
    await assert.rejects(() => assertCanAddMember(org), /3 people/);
  });

  it("Free caps messages read per month at 500", async () => {
    const org = await newOrg("free4");
    await assertCanRead(org);
    await addMessages(org, 500);
    await assert.rejects(() => assertCanRead(org), /500 messages/);
  });
});

describe("one-time payments", () => {
  it("a paid month turns Team on and lifts the limits", async () => {
    const org = await newOrg("pay1");
    await addMessages(org, 500);
    const r = await applyPaidOrder(order("order_1", org, "monthly"));
    assert.equal(r.applied, true);
    assert.equal((await effectivePlan(org)).id, "team");
    await assertCanRead(org);
    const s = await billingSummary(org);
    assert.equal(s.limits.messages, 10000);
    const end = (await getBillingRow(org)).period_end!;
    assert.ok(Math.abs(end - (Date.now() + 30 * DAY)) < 60_000);
  });

  it("a year buys 365 days", async () => {
    const org = await newOrg("pay2");
    await applyPaidOrder(order("order_2", org, "yearly"));
    const end = (await getBillingRow(org)).period_end!;
    assert.ok(Math.abs(end - (Date.now() + 365 * DAY)) < 60_000);
  });

  it("the same order is only counted once (browser callback plus webhook)", async () => {
    const org = await newOrg("pay3");
    await applyPaidOrder(order("order_3", org, "monthly"));
    const first = (await getBillingRow(org)).period_end;
    const again = await applyPaidOrder(order("order_3", org, "monthly"));
    assert.equal(again.applied, false);
    assert.equal((await getBillingRow(org)).period_end, first);
  });

  it("paying again before it ends adds to the end date", async () => {
    const org = await newOrg("pay4");
    await applyPaidOrder(order("order_4a", org, "monthly"));
    await applyPaidOrder(order("order_4b", org, "monthly"));
    const end = (await getBillingRow(org)).period_end!;
    assert.ok(Math.abs(end - (Date.now() + 60 * DAY)) < 60_000);
  });

  it("when the paid time runs out the workspace is back on Free", async () => {
    const org = await newOrg("pay5");
    await applyPaidOrder(order("order_5", org, "monthly"));
    await saveBilling(org, { period_end: Date.now() - 1000 });
    assert.equal((await effectivePlan(org)).id, "free");
  });

  it("rejects an order whose amount does not match the price", async () => {
    const org = await newOrg("pay6");
    await assert.rejects(() => applyPaidOrder(order("order_6", org, "yearly", 100)), /amount/);
    assert.equal((await effectivePlan(org)).id, "free");
  });

  it("rejects an order that is not a plan purchase", async () => {
    await assert.rejects(() => applyPaidOrder({ id: "order_7", amount: 1, notes: {} }), /not a Stale plan/);
  });
});

describe("Razorpay signatures", () => {
  it("accepts the RAZORPAY_API_KEY / RAZORPAY_SECRET names", () => {
    assert.equal(billingEnabled(), true);
  });

  it("verifies a checkout signature and rejects a forged one", () => {
    const sig = createHmac("sha256", "dummy_secret").update("order_1|pay_1").digest("hex");
    assert.equal(verifyCheckout("order_1", "pay_1", sig), true);
    assert.equal(verifyCheckout("order_2", "pay_1", sig), false);
    assert.equal(verifyCheckout("order_1", "pay_1", "00"), false);
  });

  it("verifies a webhook signature over the raw body", () => {
    const body = '{"event":"order.paid"}';
    const sig = createHmac("sha256", "whsec_dummy").update(body).digest("hex");
    assert.equal(verifyWebhook(body, sig), true);
    assert.equal(verifyWebhook(body + " ", sig), false);
  });
});

describe("billing off", () => {
  it("without keys nothing is limited", async () => {
    const prev = [process.env.RAZORPAY_API_KEY, process.env.RAZORPAY_SECRET];
    delete process.env.RAZORPAY_API_KEY;
    delete process.env.RAZORPAY_SECRET;
    try {
      const org = await newOrg("off1");
      await addMessages(org, 10_000_000);
      await assertCanRead(org);
    } finally {
      process.env.RAZORPAY_API_KEY = prev[0];
      process.env.RAZORPAY_SECRET = prev[1];
    }
  });
});
