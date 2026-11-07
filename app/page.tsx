"use client";
import { useState } from "react";
type Access = { allowed: boolean; status: string };
export default function Page() {
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(path: string, body?: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The request failed.");
      const check = await fetch("/api/access", { cache: "no-store" });
      if (!check.ok) throw new Error("The access check failed.");
      setAccess(await check.json());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The request failed."); }
    finally { setBusy(false); }
  }
  function checkout() {
    let requestKey = sessionStorage.getItem("checkout-request-key");
    if (!requestKey) { requestKey = crypto.randomUUID(); sessionStorage.setItem("checkout-request-key", requestKey); }
    void run("/api/checkout", { requestKey });
  }
  return <>
    <p className="label">HELPFUL MODS / LOCAL TEACHING EXAMPLE</p>
    <h1>A successful return page does not unlock your app.</h1>
    <p>Try the pending, paid and held states below. All results are simulated. This example has no Stripe connection or customer login.</p>
    <div className="actions">
      <button disabled={busy} onClick={checkout}>Start sample checkout</button>
      <button disabled={busy} onClick={() => run("/api/lab", { status: "active" })}>Simulate confirmed payment</button>
      <button disabled={busy} onClick={() => run("/api/lab", { status: "risk_hold" })}>Simulate access hold</button>
      <button disabled={busy} onClick={() => run("/api/access")}>Check current access</button>
      <button disabled={busy} onClick={() => { sessionStorage.removeItem("checkout-request-key"); void run("/api/lab", { status: "unpaid" }); }}>Start again</button>
    </div>
    <section aria-live="polite"><h2>Current access</h2><p>{access ? `${access.status}: ${access.allowed ? "the paid resource is available" : "the paid resource stays protected"}.` : "Check access or start a sample checkout."}</p></section>
    {error && <p role="alert">{error}</p>}
    <p><a href="/paid?success=true">Open the protected resource with ?success=true</a></p>
    <p>That query parameter has no effect. The server reads current access before returning the resource.</p>
    <p><a href="https://helpfulmods.com/mods/funnel/">Explore Funnel and Revenue</a></p>
  </>;
}
