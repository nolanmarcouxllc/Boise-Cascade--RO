import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processRun } from "@/lib/engine/run";

export const runtime = "nodejs";

// Trigger an analysis run for one upload. Inserts the run row (status pending)
// and kicks off processing, returning immediately so the client can poll
// GET /api/runs/[id] for completion.
//
// Processing runs in-process (fine for a persistent Node server via `next
// start`/dev). On a serverless host this should move to a queue or the Python
// engine as a worker -- see run.ts.
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!ctx.org) {
    return NextResponse.json({ error: "No organization." }, { status: 403 });
  }
  const orgId = ctx.org.id;

  let uploadId = "";
  try {
    const body = await request.json();
    uploadId = String(body?.uploadId ?? "");
  } catch {
    /* handled below */
  }
  if (!uploadId) {
    return NextResponse.json({ error: "uploadId is required." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the upload belongs to the caller's org.
  const { data: upload } = await admin
    .from("uploads")
    .select("id, org_id")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload || upload.org_id !== orgId) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  const { data: run, error: runErr } = await admin
    .from("analysis_runs")
    .insert({ org_id: orgId, upload_id: uploadId, status: "pending" })
    .select("id")
    .single();
  if (runErr || !run) {
    return NextResponse.json(
      { error: runErr?.message ?? "Could not create run." },
      { status: 500 },
    );
  }

  // Fire-and-forget: processRun owns its own error handling and status updates.
  void processRun(admin, { orgId, uploadId, runId: run.id }).catch(() => {});

  return NextResponse.json({ runId: run.id, status: "pending" });
}
