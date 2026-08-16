import { NextResponse } from "next/server";
import { pcmilerConfigured } from "@/lib/pcmiler";

export const runtime = "nodejs";

// Public liveness probe. Reports whether the PC*MILER key is present at runtime
// (a boolean only — never the key itself) so routing config can be verified
// without authenticating.
export function GET() {
  return NextResponse.json({ status: "ok", pcmilerConfigured: pcmilerConfigured() });
}
