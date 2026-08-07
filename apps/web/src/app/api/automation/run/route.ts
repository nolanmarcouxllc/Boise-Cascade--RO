import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api-auth";
import { runAutomationForOrg } from "@/lib/automation/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

// Manual trigger for the consolidation pipeline (the scheduler runs it
// automatically; this stays for dispatcher overrides and external cron).
export async function POST(request: Request) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;
  try {
    const result = await runAutomationForOrg(guard.ctx.org.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Automation run failed" },
      { status: 500 },
    );
  }
}
