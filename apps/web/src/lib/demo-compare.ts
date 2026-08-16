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
import { resolveWithCacheDetailed, type ResolvedLeg } from "@/lib/integrations/geometry-cache";
import { type LatLng } from "@/lib/routing";
import { pcmilerConfigured, pcmilerGeocode } from "@/lib/pcmiler";

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
  isNew?: boolean; // an order just uploaded from DMSi, folded into this day
};

// A not-yet-dispatched order uploaded from a DMSi CSV (parsed client-side).
export type NewOrderInput = {
  customer_name: string | null;
  address: string | null;
  order_size: number | null;
  delivery_window: string | null;
  route_id: string | null;
  lat: number | null;
  lng: number | null;
};

// Where an uploaded order ended up: its own truck before the bridge, and the
// truck it landed on after (shared, if the bridge could consolidate it).
export type NewOrderPlacement = {
  id: string;
  customer: string;
  weight: number;
  beforeTruck: string | null;
  afterTruck: string | null;
  consolidated: boolean; // the after-truck also carries other stops
  afterTruckStops: number;
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
      provider: string; // the provider that ACTUALLY drew the routes
      pcmilerConfigured: boolean; // whether the PC*MILER key is present at runtime
      providerCounts: Record<string, number>; // legs drawn by each provider
      day: string;
      days: string[];
      depot: { name: string; lat: number; lng: number };
      before: SideView;
      after: SideView;
      savings: { trucks: number; miles: number; hours: number; cost: number };
      newOrders: NewOrderPlacement[]; // uploaded orders folded into this day
      warnings: string[];
    };

export async function runComparison(
  orgId: string,
  requestedDate: string | null,
  extraOrders: NewOrderInput[] = [],
): Promise<ComparisonResult> {
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

  // Fold any uploaded (not-yet-dispatched) orders into THIS day. Each gets its
  // own fresh truck, so the BEFORE picture shows the extra separate trip dispatch
  // would add today; the bridge (AFTER) decides whether it can share a truck.
  const dayRecords = recordsForDay(allRecords, day);
  const warnings: string[] = [];
  const newIds = new Set<string>();
  let n = 0;
  for (const o of extraOrders) {
    let lat = o.lat;
    let lng = o.lng;
    if ((lat == null || lng == null) && o.address) {
      const geo = await pcmilerGeocode(o.address);
      if (geo) [lat, lng] = geo;
    }
    if (lat == null || lng == null) {
      warnings.push(`Couldn't place "${o.customer_name ?? o.address ?? "order"}" on the map — no address match, so it was skipped.`);
      continue;
    }
    const id = `new-${n}`;
    newIds.add(id);
    dayRecords.push({
      id,
      route_id: o.route_id,
      customer_name: o.customer_name ?? "Uploaded order",
      address: o.address,
      delivery_date: day,
      delivery_window: o.delivery_window,
      order_size: o.order_size,
      truck_id: `NEW-${n + 1}`,
      lat,
      lng,
    });
    n++;
  }

  const fleet = buildFleet(dayRecords, DEFAULT_CONFIG, depot);

  const depotPt: LatLng = [depot.lat, depot.lng];
  const legOf = (r: TruckRoute): LatLng[] => [depotPt, ...r.stops.map((s) => [s.lat, s.lng] as LatLng), depotPt];
  const [beforeLegs, afterLegs] = await Promise.all([
    resolveWithCacheDetailed(orgId, fleet.before.map(legOf)),
    resolveWithCacheDetailed(orgId, fleet.after.map(legOf)),
  ]);

  const before = toSide(fleet.before, beforeLegs.map((l) => l.geometry), newIds);
  const after = toSide(fleet.after, afterLegs.map((l) => l.geometry), newIds);
  const newOrders = computePlacements(newIds, before, after);

  // Provider reflects what actually drew the routes, not just what's configured.
  const providerCounts = tallyProviders([...beforeLegs, ...afterLegs]);
  const provider = dominantProvider(providerCounts);

  return {
    ok: true,
    provider,
    pcmilerConfigured: pcmilerConfigured(),
    providerCounts,
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
    newOrders,
    warnings,
  };
}

// Trace each uploaded order to the truck it rode before vs after the bridge.
function computePlacements(newIds: Set<string>, before: SideView, after: SideView): NewOrderPlacement[] {
  const out: NewOrderPlacement[] = [];
  for (const id of newIds) {
    const b = findStop(before, id);
    const a = findStop(after, id);
    const stop = b?.stop ?? a?.stop;
    if (!stop) continue;
    const afterTruckStops = a?.route.stops.length ?? 0;
    out.push({
      id,
      customer: stop.customer,
      weight: stop.weight,
      beforeTruck: b?.route.truckId ?? null,
      afterTruck: a?.route.truckId ?? null,
      consolidated: afterTruckStops > 1,
      afterTruckStops,
    });
  }
  return out;
}

function findStop(side: SideView, id: string): { route: RouteView; stop: StopView } | null {
  for (const route of side.routes) {
    const stop = route.stops.find((s) => s.id === id);
    if (stop) return { route, stop };
  }
  return null;
}

function tallyProviders(legs: ResolvedLeg[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of legs) counts[l.provider] = (counts[l.provider] ?? 0) + 1;
  return counts;
}

// The provider that drew the most legs, preferring a real road provider over the
// straight-line last resort when both are present.
function dominantProvider(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return "straight";
  const road = entries.filter(([p]) => p !== "straight");
  const pool = road.length ? road : entries;
  return pool.sort((a, b) => b[1] - a[1])[0][0];
}

function recordsForDay(records: RecordInput[], day: string): RecordInput[] {
  return records.filter((r) => (r.delivery_date ?? "").slice(0, 10) === day);
}

function toSide(routes: TruckRoute[], geom: LatLng[][], newIds: Set<string>): SideView {
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
        isNew: newIds.has(s.id),
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
