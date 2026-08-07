/**
 * Fleet optimizer. Builds the BEFORE picture (routes as dispatched) and the
 * AFTER picture (consolidation plan) for a set of delivery records.
 *
 * Scope (per product decision): consolidate candidate groups — same customer
 * same day, and geo-clusters within the detection radius — onto the FEWEST
 * legal trucks (<= max_cargo_payload_lbs), then re-sequence each affected
 * truck's stops with nearest-neighbor. Clean runs are left as dispatched. This
 * is NOT a from-scratch weekly VRP (that needs live inventory / driver / window
 * data we don't have yet).
 */

import type { EngineConfig } from "@/lib/config";
import { distanceMiles } from "@/lib/engine/geo";
import { findCandidates, type Stop } from "@/lib/engine/detect";

export type FleetStop = {
  id: string; // delivery_records uuid
  orderNumber: string | null;
  customer: string;
  address: string | null;
  lat: number;
  lng: number;
  weight: number;
  truckId: string;
  date: string;
  window: string | null;
  isCandidate: boolean;
  candidateType?: "same_customer" | "geo_cluster";
  groupId?: string;
};

export type TruckRoute = {
  key: string; // date|truckId
  truckId: string;
  date: string;
  stops: FleetStop[]; // ordered depot -> stops -> depot
  totalWeight: number;
  remainingCapacity: number;
  miles: number;
  hasCandidate: boolean;
};

export type Fleet = {
  before: TruckRoute[];
  after: TruckRoute[];
  trucksBefore: number;
  trucksAfter: number;
  milesBefore: number;
  milesAfter: number;
};

export type RecordInput = {
  id: string;
  route_id: string | null; // DMSi/EDI order number
  customer_name: string | null;
  address: string | null;
  delivery_date: string | null;
  delivery_window: string | null;
  order_size: number | null;
  truck_id: string | null;
  lat: number | null;
  lng: number | null;
};

type Depot = { lat: number; lng: number };

export function buildFleet(records: RecordInput[], config: EngineConfig, depot: Depot): Fleet {
  const depotPt: [number, number] = [depot.lat, depot.lng];
  const maxLoad = config.vehicle_constraints.max_cargo_payload_lbs;

  // 1) Which records are consolidation candidates (and their group + type)?
  const stops: Stop[] = [];
  for (const r of records) {
    if (r.lat == null || r.lng == null || !r.delivery_date || !r.truck_id) continue;
    stops.push({
      order_id: r.id,
      date: r.delivery_date.slice(0, 10),
      customer_key: r.customer_name ?? r.id,
      customer_name: r.customer_name ?? "(unnamed)",
      truck_id: r.truck_id,
      weight_lbs: r.order_size ?? 0,
      lat: r.lat,
      lng: r.lng,
    });
  }
  const groups = findCandidates(stops, config);
  const candidateOf = new Map<string, { groupId: string; type: "same_customer" | "geo_cluster" }>();
  for (const g of groups) {
    for (const oid of g.order_ids) candidateOf.set(oid, { groupId: g.group_id, type: g.type });
  }

  // 2) FleetStops
  const fleetStops: FleetStop[] = [];
  for (const r of records) {
    if (r.lat == null || r.lng == null || !r.delivery_date || !r.truck_id) continue;
    const cand = candidateOf.get(r.id);
    fleetStops.push({
      id: r.id,
      orderNumber: r.route_id,
      customer: r.customer_name ?? "(unnamed)",
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      weight: r.order_size ?? 0,
      truckId: r.truck_id,
      date: r.delivery_date.slice(0, 10),
      window: r.delivery_window,
      isCandidate: !!cand,
      candidateType: cand?.type,
      groupId: cand?.groupId,
    });
  }

  // 3) BEFORE: group by (date, truck), sequence nearest-neighbor.
  const beforeMap = new Map<string, FleetStop[]>();
  for (const s of fleetStops) {
    const k = `${s.date}|${s.truckId}`;
    (beforeMap.get(k) ?? beforeMap.set(k, []).get(k)!).push(s);
  }
  const before = Array.from(beforeMap.entries()).map(([, ss]) => makeRoute(ss, depotPt, maxLoad));

  // 4) AFTER: move each candidate group's stops onto its primary (earliest
  //    dispatch wave) truck; drop trucks that empty out; re-sequence.
  const afterMap = new Map<string, FleetStop[]>();
  for (const s of fleetStops) {
    const k = `${s.date}|${s.truckId}`;
    (afterMap.get(k) ?? afterMap.set(k, []).get(k)!).push(s);
  }
  for (const g of groups) {
    const groupStops = g.order_ids.map((oid) => fleetStops.find((s) => s.id === oid)).filter(Boolean) as FleetStop[];
    if (groupStops.length < 2) continue;
    const date = groupStops[0].date;
    const primaryTruck = primaryTruckFor(groupStops);
    const primaryKey = `${date}|${primaryTruck}`;
    // Remove group stops from every truck, then place all on primary.
    for (const gs of groupStops) {
      const fromKey = `${date}|${gs.truckId}`;
      const arr = afterMap.get(fromKey);
      if (arr) {
        const idx = arr.findIndex((x) => x.id === gs.id);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }
    const target = afterMap.get(primaryKey) ?? afterMap.set(primaryKey, []).get(primaryKey)!;
    for (const gs of groupStops) target.push({ ...gs, truckId: primaryTruck });
  }
  const after = Array.from(afterMap.entries())
    .filter(([, ss]) => ss.length > 0)
    .map(([, ss]) => makeRoute(ss, depotPt, maxLoad));

  return {
    before,
    after,
    trucksBefore: before.length,
    trucksAfter: after.length,
    milesBefore: round1(before.reduce((a, r) => a + r.miles, 0)),
    milesAfter: round1(after.reduce((a, r) => a + r.miles, 0)),
  };
}

// The primary truck keeps the stop: the earliest dispatch wave (wave-1 truck
// that already had capacity), falling back to the first truck id.
function primaryTruckFor(stops: FleetStop[]): string {
  const sorted = [...stops].sort((a, b) => (a.window ?? "").localeCompare(b.window ?? "") || a.truckId.localeCompare(b.truckId));
  return sorted[0].truckId;
}

function makeRoute(stops: FleetStop[], depot: [number, number], maxLoad: number): TruckRoute {
  const ordered = nearestNeighbor(depot, stops);
  const totalWeight = ordered.reduce((a, s) => a + s.weight, 0);
  return {
    key: `${ordered[0].date}|${ordered[0].truckId}`,
    truckId: ordered[0].truckId,
    date: ordered[0].date,
    stops: ordered,
    totalWeight,
    remainingCapacity: Math.max(0, maxLoad - totalWeight),
    miles: round1(routeMiles(depot, ordered)),
    hasCandidate: ordered.some((s) => s.isCandidate),
  };
}

function nearestNeighbor(depot: [number, number], stops: FleetStop[]): FleetStop[] {
  const remaining = [...stops];
  const out: FleetStop[] = [];
  let cur = depot;
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceMiles(cur, [remaining[i].lat, remaining[i].lng]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = remaining.splice(best, 1)[0];
    out.push(next);
    cur = [next.lat, next.lng];
  }
  return out;
}

function routeMiles(depot: [number, number], ordered: FleetStop[]): number {
  if (ordered.length === 0) return 0;
  let miles = 0;
  let cur = depot;
  for (const s of ordered) {
    miles += distanceMiles(cur, [s.lat, s.lng]);
    cur = [s.lat, s.lng];
  }
  miles += distanceMiles(cur, depot); // return to yard
  return miles;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
