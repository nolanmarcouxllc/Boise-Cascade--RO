import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Poll target: returns the run's status (and totals once completed). RLS on the
// user's session scopes this to their org automatically.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: run } = await supabase
    .from("analysis_runs")
    .select("id, status, params, upload_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  return NextResponse.json({
    runId: run.id,
    status: run.status,
    totals: run.params?.totals ?? null,
    error: run.params?.error ?? null,
  });
}
