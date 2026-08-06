// Port of apps/engine/detect.py -- flag consolidation candidates.
// Same-day deliveries split across >1 truck, by same customer or tight geo cluster.

import type { EngineConfig } from "@/lib/config";
import { distanceMiles } from "@/lib/engine/geo";

export type Stop = {
  order_id: string;
  date: string; // YYYY-MM-DD
  customer_key: string; // grouping key (customer_name in this schema)
  customer_name: string;
  truck_id: string;
  weight_lbs: number; // 0 when unknown
  lat: number;
  lng: number;
};

export type CandidateGroup = {
  group_id: string;
  date: string;
  type: "same_customer" | "geo_cluster";
  customer_names: string[];
  truck_ids: string[];
  order_ids: string[];
  delivery_count: number;
  distinct_trucks: number;
  total_weight_lbs: number;
  min_trucks_needed: number;
  centroid: [number, number];
};

export function findCandidates(
  stops: Stop[],
  config: EngineConfig,
): CandidateGroup[] {
  const det = config.detection;
  const groups: CandidateGroup[] = [];

  // Only stops with a date and coordinates participate.
  const usable = stops.filter(
    (s) => s.date && Number.isFinite(s.lat) && Number.isFinite(s.lng),
  );

  const byDay = groupBy(usable, (s) => s.date);

  for (const [day, dayStops] of byDay) {
    const claimed = new Set<Stop>();

    // --- same-customer duplicates ---
    if (det.same_customer) {
      const byCustomer = groupBy(dayStops, (s) => s.customer_key);
      for (const [, custStops] of byCustomer) {
        const trucks = distinctTrucks(custStops);
        if (trucks >= det.min_trucks && trucks > minTrucksNeeded(custStops, det.max_load_lbs)) {
          custStops.forEach((s) => claimed.add(s));
          groups.push(
            summarize(custStops, `${day}|CUST|${custStops[0].customer_key}`, "same_customer", day, det.max_load_lbs),
          );
        }
      }
    }

    // --- geo clusters over the not-yet-claimed stops ---
    if (det.geo_cluster) {
      const remaining = dayStops.filter((s) => !claimed.has(s));
      for (const cluster of clusterByDistance(remaining, det.cluster_radius_miles)) {
        const trucks = distinctTrucks(cluster);
        if (trucks >= det.min_trucks && trucks > minTrucksNeeded(cluster, det.max_load_lbs)) {
          groups.push(
            summarize(cluster, `${day}|GEO|${groups.length}`, "geo_cluster", day, det.max_load_lbs),
          );
        }
      }
    }
  }

  return groups;
}

function distinctTrucks(stops: Stop[]): number {
  return new Set(stops.map((s) => s.truck_id)).size;
}

// Fewest legal trucks that could carry the group's combined weight. A split is
// waste only if fewer trucks would have sufficed — a two-truck split of 74k lbs
// is correct dispatch, never a candidate.
function minTrucksNeeded(stops: Stop[], maxLoadLbs: number): number {
  if (!maxLoadLbs) return 1;
  const total = stops.reduce((a, s) => a + (s.weight_lbs || 0), 0);
  return Math.max(1, Math.ceil(total / maxLoadLbs));
}

// Greedy single-link clustering by geodesic distance. Fine for a day's stops.
function clusterByDistance(stops: Stop[], radiusMiles: number): Stop[][] {
  const unseen = new Set(stops);
  const clusters: Stop[][] = [];

  while (unseen.size) {
    const seed = unseen.values().next().value as Stop;
    unseen.delete(seed);
    const cluster = [seed];
    const frontier = [seed];
    while (frontier.length) {
      const cur = frontier.pop()!;
      for (const other of Array.from(unseen)) {
        if (
          distanceMiles([cur.lat, cur.lng], [other.lat, other.lng]) <= radiusMiles
        ) {
          unseen.delete(other);
          cluster.push(other);
          frontier.push(other);
        }
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }
  return clusters;
}

function summarize(
  stops: Stop[],
  groupId: string,
  type: CandidateGroup["type"],
  day: string,
  maxLoadLbs: number,
): CandidateGroup {
  const lat = mean(stops.map((s) => s.lat));
  const lng = mean(stops.map((s) => s.lng));
  return {
    group_id: groupId,
    date: day,
    type,
    customer_names: uniqueSorted(stops.map((s) => s.customer_name)),
    truck_ids: uniqueSorted(stops.map((s) => s.truck_id)),
    order_ids: stops.map((s) => s.order_id),
    delivery_count: stops.length,
    distinct_trucks: distinctTrucks(stops),
    total_weight_lbs: stops.reduce((a, s) => a + (s.weight_lbs || 0), 0),
    min_trucks_needed: minTrucksNeeded(stops, maxLoadLbs),
    centroid: [lat, lng],
  };
}

// --- small helpers ---
function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return map;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function uniqueSorted(xs: string[]): string[] {
  return Array.from(new Set(xs)).sort();
}
