// Local teaching fixture only. It has no login, persistence or Stripe connection.
const state = globalThis.__helpfulModsPaidAccessLab ??= { status: "unpaid", checkoutKey: null };
export function assertLocal(request) {
  const address = new URL(request.url);
  const host = request.headers.get("host") ?? address.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new Error("This teaching fixture runs on localhost only.");
  const expectedOrigin = `${address.protocol}//${host}`;
  if (request.method !== "GET" && request.headers.get("origin") !== expectedOrigin) {
    throw new Error("Open the example on its own local origin.");
  }
}
export function beginCheckout(requestKey) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestKey)) throw new Error("A checkout request key is required.");
  if (state.checkoutKey && state.checkoutKey !== requestKey && state.status === "pending") throw new Error("Keep the original pending request key.");
  state.checkoutKey = requestKey;
  if (state.status !== "active") state.status = "pending";
  return { status: state.status, checkoutId: "lab_checkout", simulated: true };
}
export function setLabStatus(status) {
  if (!["active", "risk_hold", "unpaid"].includes(status)) throw new Error("Choose a supported teaching state.");
  if (status === "active" && !state.checkoutKey) throw new Error("Start the sample checkout first.");
  state.status = status;
  if (status === "unpaid") state.checkoutKey = null;
}
export function labAccess() { return { allowed: state.status === "active", status: state.status, simulated: true }; }
