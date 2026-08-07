import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Local simulation target for DMSi pushes when DMSI_LIVE_MODE != true. It never
// touches the real ERP — it just accepts the payload and echoes an ack so the
// full push code path runs and the payload can be validated from the audit log.
export async function POST(request: Request) {
  let planDate: string | undefined;
  let routes = 0;
  try {
    const body = await request.json();
    planDate = body?.planDate;
    routes = Array.isArray(body?.routes) ? body.routes.length : 0;
  } catch {
    /* ignore */
  }
  return NextResponse.json({
    ack: true,
    simulated: true,
    receivedPlanDate: planDate ?? null,
    receivedRoutes: routes,
    note: "DMSI_LIVE_MODE=false — payload not sent to production DMSi",
  });
}
