import { NextResponse } from "next/server";
import { requireOrg, assertOrg } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { distanceMiles } from "@/lib/engine/geo";
import { resolveWithCache } from "@/lib/integrations/geometry-cache";
import { activeProvider, type LatLng } from "@/lib/routing";

export const runtime = "nodejs";

type Rec = {
  id: string; route_id: string | null; customer_name: string | null; address: string | null;
  delivery_date: string | null; delivery_window: string | null; order_size: number | null;
  truck_id: string | null; lat: number | null; lng: number | null;
};

// Full detail for one finding: why it happened (dispatch-wave split), the
// per-truck manifest, embedded BEFORE (involved trucks' full day routes) and
// AFTER (one consolidated route), and the numbers. Auth + org scoped.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.org.id;
  const admin = createAdminClient();

  const { data: finding } = await admin
    .from("consolidation_findings")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!finding) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const iso = await assertOrg(finding.org_id, orgId);
  if (iso) return iso;

  const plan = finding.consolidated_plan_json ?? {};
  const date: string = finding.date;
  const truckIds: string[] = plan.truck_ids ?? [];
  const orderIds: string[] = plan.order_ids ?? [];
  const maxLoad = DEFAULT_CONFIG.vehicle_constraints.max_cargo_payload_lbs;
  const depot = DEFAULT_CONFIG.costs.depot;
  const depotPt: LatLng = [depot.lat, depot.lng];

  // upload for this run (to scope full-day routes)
  const { data: run } = await admin.from("analysis_runs").select("upload_id").eq("id", finding.run_id).maybeSingle();
  const uploadId = run?.upload_id ?? null;

  // group records + involved trucks' full-day records
  const { data: groupRecs } = await admin.from("delivery_records").select("*").in("id", orderIds);
  const group = (groupRecs ?? []) as Rec[];

  let dayRecs: Rec[] = [];
  if (uploadId) {
    const { data } = await admin
      .from("delivery_records")
      .select("*")
      .eq("org_id", orgId)
      .eq("upload_id", uploadId)
      .eq("delivery_date", date)
      .in("truck_id", truckIds);
    dayRecs = (data ?? []) as Rec[];
  }

  // dispatch-wave breakdown from the group
  const waveCounts = new Map<string, number>();
  for (const r of group) waveCounts.set(r.delivery_window ?? "—", (waveCounts.get(r.delivery_window ?? "—") ?? 0) + 1);
  const waves = Array.from(waveCounts.entries()).sort().map(([window, count]) => ({ window, count }));

  // per-truck manifest (full day) + capacity
  const byTruck = new Map<string, Rec[]>();
  for (const r of dayRecs) {
    const t = r.truck_id ?? "?";
    (byTruck.get(t) ?? byTruck.set(t, []).get(t)!).push(r);
  }
  const groupIds = new Set(orderIds);
  // BOL line items (stored in the finding), keyed by delivery-record id.
  const lineItems = (plan.line_items ?? []) as {
    order_number: string; record_id: string | null; customer: string | null;
    product: string | null; quantity: number | null; unit: string | null;
    board_feet: number | null; weight_lbs: number | null;
  }[];
  const liByRecord = new Map(lineItems.filter((li) => li.record_id).map((li) => [li.record_id as string, li]));

  const manifest = Array.from(byTruck.entries()).map(([truckId, recs]) => {
    const dayWeight = recs.reduce((a, r) => a + (r.order_size ?? 0), 0);
    return {
      truckId,
      dayWeightLbs: dayWeight,
      remainingCapacityLbs: Math.max(0, maxLoad - dayWeight),
      stops: recs.map((r) => {
        const li = liByRecord.get(r.id);
        return {
          orderNumber: li?.order_number ?? r.route_id,
          customer: r.customer_name,
          weightLbs: r.order_size ?? 0,
          window: r.delivery_window,
          inGroup: groupIds.has(r.id),
          product: li?.product ?? null,
          quantity: li?.quantity ?? null,
          unit: li?.unit ?? null,
          boardFeet: li?.board_feet ?? null,
        };
      }),
    };
  });

  const combinedGroupWeight = group.reduce((a, r) => a + (r.order_size ?? 0), 0);

  // BEFORE routes = each involved truck's full-day route (nearest-neighbor).
  const beforeRoutes = Array.from(byTruck.entries()).map(([truckId, recs]) => {
    const pts = recs.filter((r) => r.lat != null && r.lng != null).map((r) => ({ id: r.id, customer: r.customer_name, lat: r.lat as number, lng: r.lng as number }));
    const ordered = nn(depotPt, pts);
    return { truckId, stops: ordered };
  });
  // AFTER route = one consolidated truck hitting the group's stops.
  const afterPts = group.filter((r) => r.lat != null && r.lng != null).map((r) => ({ id: r.id, customer: r.customer_name, lat: r.lat as number, lng: r.lng as number }));
  const afterOrdered = nn(depotPt, afterPts);

  // geometry (cached)
  const beforeLegs: LatLng[][] = beforeRoutes.map((r) => [depotPt, ...r.stops.map((s) => [s.lat, s.lng] as LatLng), depotPt]);
  const afterLeg: LatLng[] = [depotPt, ...afterOrdered.map((s) => [s.lat, s.lng] as LatLng), depotPt];
  const [beforeGeom, afterGeomArr] = await Promise.all([
    resolveWithCache(orgId, beforeLegs),
    resolveWithCache(orgId, [afterLeg]),
  ]);

  const leg = distanceMiles(depotPt, plan.centroid ?? depotPt);

  return NextResponse.json({
    id: finding.id,
    customer: finding.customer_name,
    date,
    type: plan.type,
    truckIds,
    distinctTrucks: plan.distinct_trucks,
    minTrucksNeeded: plan.min_trucks_needed ?? 1,
    duplicateTrucks: finding.duplicate_trucks,
    combinedGroupWeightLbs: combinedGroupWeight,
    maxLoadLbs: maxLoad,
    legal: combinedGroupWeight <= maxLoad * (plan.min_trucks_needed ?? 1),
    waves,
    manifest,
    numbers: {
      wastedMiles: finding.wasted_miles,
      wastedHours: finding.wasted_hours,
      recoverable: finding.est_cost_usd,
      cost3pl: plan.cost_3pl_benchmark,
      milesContext: `${Math.round((finding.wasted_miles ?? 0))} mi — about ${Math.max(1, Math.round((finding.wasted_miles ?? 0) / Math.max(leg * 2, 1)))} extra depot round trip(s) to ${finding.customer_name}`,
      loadFactorBefore: pct(combinedGroupWeight / Math.max(1, (plan.distinct_trucks ?? 1) * maxLoad)),
      loadFactorAfter: pct(combinedGroupWeight / Math.max(1, (plan.min_trucks_needed ?? 1) * maxLoad)),
    },
    billOfLading: lineItems,
    depot: { name: depot.name, lat: depot.lat, lng: depot.lng },
    provider: activeProvider(),
    before: beforeRoutes.map((r, i) => ({ truckId: r.truckId, stops: r.stops, geometry: beforeGeom[i] })),
    after: { stops: afterOrdered, geometry: afterGeomArr[0] },
  });
}

type P = { id: string; customer: string | null; lat: number; lng: number };
function nn(depot: LatLng, pts: P[]): P[] {
  const rem = [...pts];
  const out: P[] = [];
  let cur = depot;
  while (rem.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rem.length; i++) {
      const d = distanceMiles(cur, [rem[i].lat, rem[i].lng]);
      if (d < bd) { bd = d; bi = i; }
    }
    const next = rem.splice(bi, 1)[0];
    out.push(next);
    cur = [next.lat, next.lng];
  }
  return out;
}

const pct = (x: number) => Math.round(x * 100);
