import { headers } from "next/headers";
import { labAccess } from "../../lib/lab.mjs";
export const dynamic = "force-dynamic";
export default async function Paid() {
  const host = (await headers()).get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return <><h1>Local example only</h1><p>Run the example on localhost.</p></>;
  const access = labAccess();
  return <><p className="label">SIMULATED PAID RESOURCE</p><h1>{access.allowed ? "The paid resource is available." : "This resource is protected."}</h1><p>Current server-side status: {access.status}.</p>{access.allowed && <p data-paid-resource="true">This paragraph is the sample paid content. The server includes it only when access is active.</p>}<p><a href="/">Back to the example</a></p></>;
}
