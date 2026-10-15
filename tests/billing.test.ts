process.env.STALE_DB = ":memory:";
process.env.RAZORPAY_API_KEY = "rzp_test_dummy";
process.env.RAZORPAY_SECRET = "dummy_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_dummy";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, describe, it } from "node:test";
import { assertCanAddConnector, assertCanAddMember, assertCanRead, billingSummary, effectivePlan } from "../src/lib/billing";
import { billingEnabled, verifyCheckout, verifyWebhook } from "../src/lib/razorpay";
import { addMessages, closeSys, createAccount, createIntegration, saveBilling } from "../src/lib/system";

after(() => closeSys());

const newOrg = async (tag: string) => (await createAccount({ name: tag, email: `${tag}@x.test`, password: "password-123", orgName: tag })).org.id;

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
    const { addMemberByEmail } = await import("../src/lib/system");
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

  it("an active Team subscription lifts the limits", async () => {
    const org = await newOrg("team1");
    await addMessages(org, 500);
    await saveBilling(org, { plan: "team", status: "active", interval: "monthly", subscription_id: "sub_1", period_end: Date.now() + 86400_000 });
    await assertCanRead(org);
    const s = await billingSummary(org);
    assert.equal(s.plan, "team");
    assert.equal(s.limits.messages, 10000);
  });

  it("a cancelled plan keeps working until the paid period ends, then drops to Free", async () => {
    const org = await newOrg("team2");
    await saveBilling(org, { plan: "team", status: "cancelling", subscription_id: "sub_2", period_end: Date.now() + 86400_000 });
    assert.equal((await effectivePlan(org)).id, "team");
    await saveBilling(org, { period_end: Date.now() - 1000 });
    assert.equal((await effectivePlan(org)).id, "free");
  });

  it("a pending (unpaid) checkout does not grant the plan", async () => {
    const org = await newOrg("team3");
    await saveBilling(org, { plan: "team", status: "pending", subscription_id: "sub_3" });
    assert.equal((await effectivePlan(org)).id, "free");
  });
});

describe("Razorpay signatures", () => {
  it("accepts the RAZORPAY_API_KEY / RAZORPAY_SECRET names", () => {
    assert.equal(billingEnabled(), true);
  });

  it("verifies a checkout signature and rejects a forged one", () => {
    const sig = createHmac("sha256", "dummy_secret").update("pay_1|sub_1").digest("hex");
    assert.equal(verifyCheckout("pay_1", "sub_1", sig), true);
    assert.equal(verifyCheckout("pay_1", "sub_2", sig), false);
    assert.equal(verifyCheckout("pay_1", "sub_1", "00"), false);
  });

  it("verifies a webhook signature over the raw body", () => {
    const body = '{"event":"subscription.charged"}';
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
