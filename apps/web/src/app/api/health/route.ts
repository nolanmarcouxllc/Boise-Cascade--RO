import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Public liveness probe. Returns 200 only, no data.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
