import { assertLocal, labAccess } from "../../../lib/lab.mjs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertLocal(request);
    return Response.json(labAccess(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Open this example on localhost." }, { status: 403 });
  }
}
