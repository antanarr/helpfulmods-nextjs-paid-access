/** Original application adapter. The purchased Funnel service runs separately. */
export function createFunnelClient({ origin, tenant, offerId, signToken, fetchImpl = fetch, now = Date.now }) {
  const base = new URL(origin);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("Use the Funnel service origin without a path or credentials.");
  }
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))) {
    throw new Error("Funnel requires HTTPS outside local development.");
  }
  if (!tenant || !offerId || typeof signToken !== "function") throw new Error("Configure tenant, offer and server-side signer.");

  async function command(session, name, input, external = false) {
    if (!session?.userId || !session.emailVerified || !session.email) {
      throw new Error("A verified application session is required.");
    }
    const token = await signToken({
      aud: "helpfulmods", sub: session.userId, tenant, role: "customer",
      mods: ["funnel"], exp: Math.floor(now() / 1000) + 120,
      external, verifiedEmail: session.email.trim().toLowerCase(),
    });
    const response = await fetchImpl(new URL(`/api/funnel/commands/${name}`, base), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Funnel ${name} failed (${response.status}).`);
    return response.json();
  }

  return {
    async capture(session, consent) {
      if (typeof consent !== "boolean") throw new Error("Choose consent explicitly.");
      const result = await command(session, "capture", {
        email: session?.email?.trim().toLowerCase(), consent,
      });
      if (typeof result.customerId !== "string") throw new Error("Funnel did not return a customer ID.");
      return result.customerId;
    },
    async startCheckout(session, customerId, requestKey) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(customerId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(requestKey)) throw new Error("Use a saved customer ID and stable request key.");
      const result = await command(session, "checkout", { customerId, offerId, requestKey }, true);
      if (typeof result.checkoutId !== "string") throw new Error("Funnel did not return a checkout ID.");
      return result.checkoutId;
    },
    async checkoutStatus(session, customerId, checkoutId) {
      const result = await command(session, "customer", { customerId });
      if (!Array.isArray(result.checkouts)) throw new Error("Funnel returned an invalid customer response.");
      const checkout = result.checkouts.find(item => item.id === checkoutId);
      if (!checkout) throw new Error("The saved checkout is missing from this customer.");
      if (!checkout.url) return { ready: false, url: null };
      const url = new URL(checkout.url);
      const sessionPath = url.pathname === `/c/pay/${checkout.sessionId}` ||
        url.pathname === `/g/pay/${checkout.sessionId}`;
      if (!/^cs_[A-Za-z0-9_]+$/.test(checkout.sessionId) || url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.port || url.username || url.password || !sessionPath) {
        throw new Error("Funnel returned an unexpected checkout URL.");
      }
      return { ready: true, url: url.href };
    },
    async access(session, customerId) {
      const result = await command(session, "access", { customerId });
      if (typeof result.active !== "boolean" || typeof result.status !== "string" || !Array.isArray(result.offerIds)) {
        throw new Error("Funnel returned an invalid access response.");
      }
      return { allowed: result.active && result.offerIds.includes(offerId), status: result.status };
    },
  };
}
