/**
 * Core computation for the "Bridge" side-by-side comparison page — SERVER ONLY.
 *
 * Left  ("Without the Bridge") = orders as dispatched today (BEFORE fleet).
 * Right ("Through the Bridge")  = the same orders consolidated (AFTER fleet).
 *
 * Both fleets are routed through PC*MILER (truck-legal 53-ft flatbed geometry,
 * cached). Miles are measured along the real routed road path; cost = miles *
 * (per-mile + fuel) + drive-hours * fleet-hour rate. Auth/HTTP live in the route
 * that calls this.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { buildFleet, type RecordInput, type TruckRoute } from "@/lib/engine/optimize";
import { distanceMiles } from "@/lib/engine/geo";
import { resolveWithCache } from "@/lib/integrations/geometry-cache";
import { activeProvider, type LatLng } from "@/lib/routing";

const C = DEFAULT_CONFIG.costs;
const MILE_RATE = C.cost_per_mile + (C.fuel_surcharge_per_mile ?? 0);

export type StopView = {
  id: string;
  customer: string;
  address: string | null;
  orderNumber: string | null;
  weight: number;
  window: string | null;
  lat: number;
  lng: number;
};
export type RouteView = {
  truckId: string;
  stops: StopView[];
  weight: number;
  miles: number;
  hours: number;
  cost: number;
  geometry: LatLng[];
};
export type SideView = {
  totalRoutes: number;
  totalStops: number;
  totalMiles: number;
  totalHours: number;
  totalCost: number;
  routes: RouteView[];
};
export type ComparisonResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      provider: string;
      day: string;
      days: string[];
      depot: { name: string; lat: number; lng: number };
      before: SideView;
      after: SideView;
      savings: { trucks: number; miles: number; hours: number; cost: number };
    };

export async function runComparison(orgId: string, requestedDate: string | null): Promise<ComparisonResult> {
  const admin = createAdminClient();

  // Dataset = the latest completed run that actually analyzed deliveries (the
  // rich synthetic Westfield set), mirroring /api/fleet.
  const { data: runData } = await admin
    .from("analysis_runs")
    .select("upload_id, params")
    .eq("org_id", orgId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(10);
  const runs = (runData ?? []) as { upload_id: string | null; params: { totals?: { records_analyzed?: number } } | null }[];
  const uploadId = (runs.find((r) => (r.params?.totals?.records_analyzed ?? 0) > 0) ?? runs[0])?.upload_id ?? null;
  if (!uploadId) return { ok: false, error: "No delivery data found", status: 404 };

  const { data: recs } = await admin
    .from("delivery_records")
    .select("id, route_id, customer_name, address, delivery_date, delivery_window, order_size, truck_id, lat, lng")
    .eq("org_id", orgId)
    .eq("upload_id", uploadId);
  const allRecords = (recs ?? []) as RecordInput[];

  const days = Array.from(
    new Set(allRecords.map((r) => (r.delivery_date ?? "").slice(0, 10)).filter(Boolean)),
  ).sort();
  if (days.length === 0) return { ok: false, error: "No delivery days found", status: 404 };

  const depot = C.depot;

  // Pick the day: requested, else the day where consolidation removes the most
  // trucks (buildFleet is pure math, so scanning every day is cheap).
  let day = requestedDate && days.includes(requestedDate) ? requestedDate : "";
  if (!day) {
    let bestGain = -Infinity;
    for (const d of days) {
      const f = buildFleet(recordsForDay(allRecords, d), DEFAULT_CONFIG, depot);
      const gain = f.trucksBefore - f.trucksAfter;
      if (gain > bestGain) {
        bestGain = gain;
        day = d;
      }
    }
    if (!day) day = days[days.length - 1];
  }

  const fleet = buildFleet(recordsForDay(allRecords, day), DEFAULT_CONFIG, depot);

  const depotPt: LatLng = [depot.lat, depot.lng];
  const legOf = (r: TruckRoute): LatLng[] => [depotPt, ...r.stops.map((s) => [s.lat, s.lng] as LatLng), depotPt];
  const [beforeGeom, afterGeom] = await Promise.all([
    resolveWithCache(orgId, fleet.before.map(legOf)),
    resolveWithCache(orgId, fleet.after.map(legOf)),
  ]);

  const before = toSide(fleet.before, beforeGeom);
  const after = toSide(fleet.after, afterGeom);

  return {
    ok: true,
    provider: activeProvider(),
    day,
    days,
    depot: { name: depot.name, lat: depot.lat, lng: depot.lng },
    before,
    after,
    savings: {
      trucks: before.totalRoutes - after.totalRoutes,
      miles: round1(before.totalMiles - after.totalMiles),
      hours: round1(before.totalHours - after.totalHours),
      cost: round2(before.totalCost - after.totalCost),
    },
  };
}

function recordsForDay(records: RecordInput[], day: string): RecordInput[] {
  return records.filter((r) => (r.delivery_date ?? "").slice(0, 10) === day);
}

function toSide(routes: TruckRoute[], geom: LatLng[][]): SideView {
  const routeViews: RouteView[] = routes.map((r, i) => {
    const geometry = geom[i] ?? [];
    const miles = geometry.length >= 2 ? roadMiles(geometry) : r.miles;
    const hours = C.avg_speed_mph ? miles / C.avg_speed_mph : 0;
    const cost = miles * MILE_RATE + hours * C.cost_per_fleet_hour;
    return {
      truckId: r.truckId,
      stops: r.stops.map((s) => ({
        id: s.id,
        customer: s.customer,
        address: s.address,
        orderNumber: s.orderNumber,
        weight: Math.round(s.weight),
        window: s.window,
        lat: s.lat,
        lng: s.lng,
      })),
      weight: Math.round(r.totalWeight),
      miles: round1(miles),
      hours: round1(hours),
      cost: round2(cost),
      geometry,
    };
  });
  return {
    totalRoutes: routeViews.length,
    totalStops: routeViews.reduce((a, r) => a + r.stops.length, 0),
    totalMiles: round1(routeViews.reduce((a, r) => a + r.miles, 0)),
    totalHours: round1(routeViews.reduce((a, r) => a + r.hours, 0)),
    totalCost: round2(routeViews.reduce((a, r) => a + r.cost, 0)),
    routes: routeViews,
  };
}

// Miles along an ordered road polyline (sum of great-circle hops between the
// routed vertices — real driven distance, not straight-line depot->stop).
function roadMiles(geometry: LatLng[]): number {
  let miles = 0;
  for (let i = 1; i < geometry.length; i++) miles += distanceMiles(geometry[i - 1], geometry[i]);
  return miles;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
