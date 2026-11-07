import test from "node:test";
import assert from "node:assert/strict";
import { createFunnelClient } from "../lib/funnel-client.mjs";
import { assertLocal, beginCheckout, labAccess, setLabStatus } from "../lib/lab.mjs";

const session = { userId: "app_user_1", email: "Avery@Example.com", emailVerified: true };
function harness(replies = []) {
  const requests = [], claims = [];
  const client = createFunnelClient({
    origin: "https://funnel.example.com", tenant: "merchant", offerId: "standard", now: () => 1800000000000,
    signToken: value => { claims.push(value); return "scoped-token"; },
    fetchImpl: async (url, options) => {
      requests.push({ url: url.href, ...options, input: JSON.parse(options.body) });
      const next = replies.shift();
      if (!next) throw new Error("Unexpected request in test.");
      return Response.json(next.body, { status: next.status ?? 200 });
    },
  });
  return { client, requests, claims };
}
test("capture binds the verified server identity and normalizes its email", async () => {
  const { client, requests, claims } = harness([{ body: { customerId: "customer_1", returnToken: "private-unused-token" } }]);
  assert.equal(await client.capture(session, false), "customer_1");
  assert.deepEqual(requests[0].input, { email: "avery@example.com", consent: false });
  assert.deepEqual(claims[0], { aud: "helpfulmods", sub: "app_user_1", tenant: "merchant", role: "customer", mods: ["funnel"], exp: 1800000120, external: false, verifiedEmail: "avery@example.com" });
  assert.equal(requests[0].cache, "no-store");
  assert.equal(requests[0].headers.Authorization, "Bearer scoped-token");
});
test("provider subjects use the signed actor without the optional ownerId key restriction", async () => {
  for (const userId of ["auth0|abc", "f".repeat(128)]) {
    const { client, requests, claims } = harness([{ body: { customerId: "customer_1" } }]);
    await client.capture({ ...session, userId }, false);
    assert.equal(claims[0].sub, userId);
    assert.equal(Object.hasOwn(requests[0].input, "ownerId"), false);
  }
});
test("an unverified customer cannot reach the module", async () => {
  const { client, requests } = harness();
  await assert.rejects(client.capture({ ...session, emailVerified: false }, true), /verified application session/);
  assert.equal(requests.length, 0);
});
test("a missing session and unspecified consent fail before a request", async () => {
  const { client, requests } = harness();
  await assert.rejects(client.capture(null, false), /verified application session/);
  await assert.rejects(client.capture(session, undefined), /consent explicitly/);
  assert.equal(requests.length, 0);
});
test("checkout retries preserve customer, offer and request key", async () => {
  const { client, requests, claims } = harness([{ body: { checkoutId: "checkout_1" } }, { body: { checkoutId: "checkout_1" } }]);
  assert.equal(await client.startCheckout(session, "customer_1", "intent_1"), "checkout_1");
  assert.equal(await client.startCheckout(session, "customer_1", "intent_1"), "checkout_1");
  assert.deepEqual(requests[0].input, requests[1].input);
  assert.deepEqual(requests[0].input, { customerId: "customer_1", offerId: "standard", requestKey: "intent_1" });
  assert.equal(claims[0].external, true);
});
test("a pending worker result has no redirect", async () => {
  const { client } = harness([{ body: { checkouts: [{ id: "checkout_1", status: "queued", url: null }] } }]);
  assert.deepEqual(await client.checkoutStatus(session, "customer_1", "checkout_1"), { ready: false, url: null });
});
test("the saved checkout ID chooses the right Stripe Session", async () => {
  const { client } = harness([{ body: { checkouts: [{ id: "old", sessionId: "cs_test_old", url: "https://checkout.stripe.com/c/pay/cs_test_old" }, { id: "new", sessionId: "cs_test_new", url: "https://checkout.stripe.com/c/pay/cs_test_new" }] } }]);
  assert.deepEqual(await client.checkoutStatus(session, "customer_1", "new"), { ready: true, url: "https://checkout.stripe.com/c/pay/cs_test_new" });
});
test("unexpected redirect hosts and session bindings fail", async () => {
  for (const url of ["https://evil.example/c/pay/cs_test_new", "https://checkout.stripe.com/c/pay/cs_test_other", "https://user@checkout.stripe.com/c/pay/cs_test_new"]) {
    const { client } = harness([{ body: { checkouts: [{ id: "new", sessionId: "cs_test_new", url }] } }]);
    await assert.rejects(client.checkoutStatus(session, "customer_1", "new"), /unexpected checkout URL/);
  }
});
test("access needs an active entitlement to this offer", async () => {
  const { client, claims } = harness([
    { body: { active: false, status: "risk_hold", offerIds: [] } },
    { body: { active: true, status: "active", offerIds: ["another_offer"] } },
    { body: { active: true, status: "active", offerIds: ["standard"] } },
  ]);
  assert.deepEqual(await client.access(session, "customer_1"), { allowed: false, status: "risk_hold" });
  assert.equal((await client.access(session, "customer_1")).allowed, false);
  assert.equal((await client.access(session, "customer_1")).allowed, true);
  assert(claims.every(value => value.external === false));
});
test("an unavailable service or malformed access cannot turn into paid access", async () => {
  const { client } = harness([{ status: 503, body: { error: "unavailable" } }, { body: { active: "yes", status: "active", offerIds: ["standard"] } }]);
  await assert.rejects(client.access(session, "customer_1"), /failed \(503\)/);
  await assert.rejects(client.access(session, "customer_1"), /invalid access response/);
});
test("the service origin cannot contain credentials or use remote plain HTTP", () => {
  for (const origin of ["http://funnel.example.com", "https://token@funnel.example.com", "https://funnel.example.com/commands/"]) {
    assert.throws(() => createFunnelClient({ origin, tenant: "merchant", offerId: "standard", signToken: () => "token" }));
  }
});
test("the lab only accepts local, same-origin mutations", () => {
  assert.throws(() => assertLocal(new Request("https://example.com/api/lab")), /localhost only/);
  assert.throws(() => assertLocal(new Request("http://localhost:3000/api/lab", { method: "POST", headers: { origin: "https://other.example" } })), /own local origin/);
  assert.doesNotThrow(() => assertLocal(new Request("http://localhost:3000/api/lab", { method: "POST", headers: { origin: "http://localhost:3000" } })));
  assert.doesNotThrow(() => assertLocal(new Request("http://localhost:3000/api/lab", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })));
});
test("the teaching journey stays pending until the simulated provider state changes", () => {
  setLabStatus("unpaid");
  beginCheckout("same_intent");
  assert.equal(labAccess().allowed, false);
  assert.throws(() => beginCheckout("different_intent"), /original pending/);
  beginCheckout("same_intent");
  setLabStatus("active");
  assert.equal(labAccess().allowed, true);
  setLabStatus("risk_hold");
  assert.equal(labAccess().allowed, false);
  setLabStatus("unpaid");
});
