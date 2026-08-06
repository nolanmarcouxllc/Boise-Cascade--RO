import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Create the caller's org + first membership. Uses the service role because RLS
// blocks the orgs insert (the new org isn't in the user's memberships yet).
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let name = "";
  try {
    const body = await request.json();
    name = String(body?.name ?? "").trim();
  } catch {
    /* fall through to validation */
  }
  if (!name) {
    return NextResponse.json(
      { error: "Organization name is required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Idempotent: if the user already has a membership, return that org.
  const { data: existing } = await admin
    .from("memberships")
    .select("org_id, orgs(id, name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (existing?.org_id) {
    return NextResponse.json({ org: existing.orgs });
  }

  const { data: org, error: orgErr } = await admin
    .from("orgs")
    .insert({ name })
    .select("id, name")
    .single();
  if (orgErr || !org) {
    return NextResponse.json(
      { error: orgErr?.message ?? "Could not create organization." },
      { status: 500 },
    );
  }

  const { error: memErr } = await admin.from("memberships").insert({
    user_id: user.id,
    org_id: org.id,
    role: "admin",
  });
  if (memErr) {
    // Roll back the orphan org so a retry is clean.
    await admin.from("orgs").delete().eq("id", org.id);
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  return NextResponse.json({ org });
}
