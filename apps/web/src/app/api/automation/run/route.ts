import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAutomationForOrg } from "@/lib/automation/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

// Manual trigger for the consolidation pipeline (the scheduler runs it
// automatically in a persistent server; this stays for dispatcher overrides).
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

// Cron trigger (Vercel Cron / external schedulers on serverless, where the
// in-process scheduler can't live). Auth: Authorization: Bearer CRON_SECRET —
// Vercel attaches it automatically when the CRON_SECRET env var is set.
// Runs the pipeline for every org with queued orders.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("order_queue")
    .select("org_id")
    .eq("status", "received")
    .limit(200);
  const orgIds = Array.from(new Set((data ?? []).map((r) => r.org_id as string)));
  const results = [];
  for (const orgId of orgIds) {
    try {
      results.push({ orgId, ...(await runAutomationForOrg(orgId)) });
    } catch (e) {
      results.push({ orgId, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
