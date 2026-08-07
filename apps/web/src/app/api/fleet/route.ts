import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { buildFleet, type RecordInput, type TruckRoute } from "@/lib/engine/optimize";
import { resolveWithCache } from "@/lib/integrations/geometry-cache";
import { activeProvider, type LatLng } from "@/lib/routing";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby cap; cold "all"-scope loads may need a warm cache

// Build the BEFORE/AFTER fleet picture for a period and attach road geometry
// (PC*MILER when keyed, else OSRM), cached in route_geometry_cache. Auth-gated
// + org-scoped: records are read for the caller's org only.
//
// Query: ?uploadId=<uuid> (defaults to latest completed run's upload)
//        ?scope=day|week|all  &date=YYYY-MM-DD (anchor for day/week)
export async function POST(request: Request) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.org.id;
  const admin = createAdminClient();

  const body = await request.json().catch(() => ({}));
  const scope: "day" | "week" | "all" = ["day", "week", "all"].includes(body?.scope) ? body.scope : "day";
  const anchor: string | undefined = typeof body?.date === "string" ? body.date : undefined;

  // Resolve upload: explicit, else latest completed run's upload.
  let uploadId: string | null = typeof body?.uploadId === "string" ? body.uploadId : null;
  if (!uploadId) {
    const { data: run } = await admin
      .from("analysis_runs")
      .select("upload_id")
      .eq("org_id", orgId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    uploadId = (run?.upload_id as string) ?? null;
  }
  if (!uploadId) return NextResponse.json({ error: "No dataset found" }, { status: 404 });

  // Records for this upload (org-scoped).
  const { data: recs } = await admin
    .from("delivery_records")
    .select("id, route_id, customer_name, address, delivery_date, delivery_window, order_size, truck_id, lat, lng")
    .eq("org_id", orgId)
    .eq("upload_id", uploadId);
  let records = (recs ?? []) as RecordInput[];

  // Available days (for the filter UI).
  const allDays = Array.from(new Set(records.map((r) => (r.delivery_date ?? "").slice(0, 10)).filter(Boolean))).sort();

  // Date filtering.
  const anchorDate = anchor && allDays.includes(anchor) ? anchor : allDays[allDays.length - 1];
  if (scope === "day") {
    records = records.filter((r) => (r.delivery_date ?? "").slice(0, 10) === anchorDate);
  } else if (scope === "week") {
    // week = the Mon-Fri block containing the anchor (our data is 2 such weeks).
    const week = weekOf(anchorDate, allDays);
    records = records.filter((r) => week.includes((r.delivery_date ?? "").slice(0, 10)));
  }

  const depot = DEFAULT_CONFIG.costs.depot;
  const fleet = buildFleet(records, DEFAULT_CONFIG, depot);

  // Resolve geometry for every route (depot -> stops -> depot), cached.
  const depotPt: LatLng = [depot.lat, depot.lng];
  const legFor = (route: TruckRoute): LatLng[] => [depotPt, ...route.stops.map((s) => [s.lat, s.lng] as LatLng), depotPt];
  const beforeLegs = fleet.before.map(legFor);
  const afterLegs = fleet.after.map(legFor);
  const [beforeGeom, afterGeom] = await Promise.all([
    resolveWithCache(orgId, beforeLegs),
    resolveWithCache(orgId, afterLegs),
  ]);

  const attach = (routes: TruckRoute[], geom: LatLng[][]) =>
    routes.map((r, i) => ({ ...r, geometry: geom[i] }));

  return NextResponse.json({
    provider: activeProvider(),
    scope,
    anchorDate,
    days: allDays,
    depot: { name: depot.name, lat: depot.lat, lng: depot.lng },
    trucksBefore: fleet.trucksBefore,
    trucksAfter: fleet.trucksAfter,
    milesBefore: fleet.milesBefore,
    milesAfter: fleet.milesAfter,
    before: attach(fleet.before, beforeGeom),
    after: attach(fleet.after, afterGeom),
  });
}

// Return the contiguous business-week block of days containing `date`.
function weekOf(date: string, allDays: string[]): string[] {
  const idx = allDays.indexOf(date);
  if (idx < 0) return allDays;
  // Group the sorted days into runs where consecutive entries are <= 3 days
  // apart (Fri->Mon gap = 3), then return the run containing `date`.
  const runs: string[][] = [];
  let cur: string[] = [];
  for (let i = 0; i < allDays.length; i++) {
    if (cur.length === 0) cur = [allDays[i]];
    else {
      const prev = new Date(allDays[i - 1] + "T00:00:00Z").getTime();
      const now = new Date(allDays[i] + "T00:00:00Z").getTime();
      const gapDays = (now - prev) / 86400000;
      // gap of 1–2 days = same week; a Fri->Mon weekend gap (3) starts a new week
      if (gapDays < 3) cur.push(allDays[i]);
      else {
        runs.push(cur);
        cur = [allDays[i]];
      }
    }
  }
  if (cur.length) runs.push(cur);
  return runs.find((r) => r.includes(date)) ?? allDays;
}
