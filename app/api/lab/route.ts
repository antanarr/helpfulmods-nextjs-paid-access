import { assertLocal, labAccess, setLabStatus } from "../../../lib/lab.mjs";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocal(request);
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || !("status" in input) || typeof input.status !== "string") {
      return Response.json({ error: "Choose a sample state." }, { status: 400 });
    }
    setLabStatus(input.status);
    return Response.json(labAccess(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The sample state could not change." }, { status: 400 });
  }
}
