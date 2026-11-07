import { assertLocal, beginCheckout } from "../../../lib/lab.mjs";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocal(request);
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || !("requestKey" in input) || typeof input.requestKey !== "string") {
      return Response.json({ error: "A saved request key is required." }, { status: 400 });
    }
    return Response.json(beginCheckout(input.requestKey), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The local example failed." }, { status: 400 });
  }
}
