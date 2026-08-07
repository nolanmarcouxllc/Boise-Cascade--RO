import { NextResponse } from "next/server";
import { requireOrg, assertOrg } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { writeAudit } from "@/lib/integrations/audit";

export const runtime = "nodejs";

type PlanStop = {
  sequence: number; recordId: string; orderNumber: string | null; customer: string;
  address: string | null; weightLbs: number; wave: string; lat: number; lng: number;
};
type PlanRoute = { truckId: string; date: string; totalWeightLbs: number; miles: number; stops: PlanStop[] };

// GET: load an automated plan for review. PATCH: save a dispatcher override
// (stops moved/resequenced/removed) — audited with who and what changed.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;
  const admin = createAdminClient();
  const { data: row } = await admin.from("optimized_plans").select("*").eq("id", params.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const iso = await assertOrg(row.org_id, guard.ctx.org.id);
  if (iso) return iso;
  return NextResponse.json({
    id: row.id,
    plan: row.plan,
    trucksBefore: row.trucks_before,
    trucksAfter: row.trucks_after,
    maxLoadLbs: DEFAULT_CONFIG.vehicle_constraints.max_cargo_payload_lbs,
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.org.id;
  const admin = createAdminClient();

  const { data: row } = await admin.from("optimized_plans").select("*").eq("id", params.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const iso = await assertOrg(row.org_id, orgId);
  if (iso) return iso;

  let editedRoutes: PlanRoute[] = [];
  try {
    const body = await request.json();
    editedRoutes = Array.isArray(body?.routes) ? body.routes : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only rearrangement of the ORIGINAL stops is allowed — no injected stops.
  const original = (row.plan?.routes ?? []) as PlanRoute[];
  const origStops = new Map<string, PlanStop>();
  const origTruckOf = new Map<string, string>();
  for (const r of original) {
    for (const s of r.stops) {
      origStops.set(s.recordId, s);
      origTruckOf.set(s.recordId, r.truckId);
    }
  }
  const seen = new Set<string>();
  for (const r of editedRoutes) {
    if (!Array.isArray(r.stops)) return NextResponse.json({ error: "Bad route shape" }, { status: 400 });
    for (const s of r.stops) {
      if (!origStops.has(s.recordId)) return NextResponse.json({ error: `Unknown stop ${s.recordId}` }, { status: 400 });
      if (seen.has(s.recordId)) return NextResponse.json({ error: `Duplicate stop ${s.recordId}` }, { status: 400 });
      seen.add(s.recordId);
    }
  }

  // Rebuild routes server-side from trusted originals (weights can't be forged).
  const cap = DEFAULT_CONFIG.vehicle_constraints.max_cargo_payload_lbs;
  const rebuilt: PlanRoute[] = editedRoutes
    .filter((r) => r.stops.length > 0)
    .map((r) => {
      const stops = r.stops.map((s, i) => ({ ...origStops.get(s.recordId)!, sequence: i + 1 }));
      const date =
        original.find((o) => o.stops.some((x) => x.recordId === stops[0].recordId))?.date ?? r.date;
      return {
        truckId: r.truckId,
        date,
        totalWeightLbs: stops.reduce((a, s) => a + (s.weightLbs || 0), 0),
        miles: 0, // estimate recomputed at push time
        stops,
      };
    });
  const overweight = rebuilt.filter((r) => r.totalWeightLbs > cap);
  if (overweight.length) {
    return NextResponse.json(
      { error: `Truck ${overweight[0].truckId} exceeds legal payload (${overweight[0].totalWeightLbs.toLocaleString()} lb > ${cap.toLocaleString()} lb)` },
      { status: 422 },
    );
  }

  // Change summary: moved + removed.
  const moved: string[] = [];
  for (const r of rebuilt) {
    for (const s of r.stops) {
      if (origTruckOf.get(s.recordId) !== r.truckId) {
        moved.push(`${s.orderNumber ?? s.recordId} ${origTruckOf.get(s.recordId)}->${r.truckId}`);
      }
    }
  }
  const removed = Array.from(origStops.keys())
    .filter((id) => !seen.has(id))
    .map((id) => origStops.get(id)!.orderNumber ?? id);
  const changes = [
    moved.length ? `moved: ${moved.join(", ")}` : null,
    removed.length ? `removed: ${removed.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ") || "resequenced only";

  const newPlan = {
    ...row.plan,
    routes: rebuilt,
    overriddenAt: new Date().toISOString(),
    overriddenBy: guard.ctx.email,
  };
  await admin
    .from("optimized_plans")
    .update({ plan: newPlan, trucks_after: rebuilt.length })
    .eq("id", params.id);

  await writeAudit({
    orgId,
    sourceSystem: "optimizer",
    eventType: "plan_override",
    direction: "inbound",
    status: "success",
    recordCount: rebuilt.length,
    message: `Override by ${guard.ctx.email}: ${changes}`,
    payload: { planId: params.id, changes, routes: rebuilt.length },
  });

  return NextResponse.json({ ok: true, changes, trucks: rebuilt.length });
}
