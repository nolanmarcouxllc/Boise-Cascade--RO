/**
 * Pre-dispatch consolidation planner. Queue orders have NO trucks yet (dispatch
 * hasn't run) — this builds the dispatch plan itself:
 *
 *   BASELINE  = how blind dispatch runs today: each release wave is routed
 *               independently (PC*MILER never sees the later wave).
 *   PLANNED   = the full-day picture: same-customer orders merged across waves,
 *               nearby stops packed together, every truck <= the legal payload.
 *
 * The recoverable number is the cost delta between the two, using the same
 * rate card as the diagnostic engine. Distances are haversine estimates here;
 * real PC*MILER commercial mileage/geometry is attached in the routing step.
 */

import type { EngineConfig } from "@/lib/config";
import { distanceMiles } from "@/lib/engine/geo";

export type PlanOrder = {
  recordId: string;
  orderNumber: string | null;
  customer: string;
  address: string | null;
  lat: number;
  lng: number;
  weightLbs: number;
  wave: string; // dispatch window, e.g. "06:30"
  date: string; // YYYY-MM-DD
};

export type PlannedRoute = {
  truckId: string;
  stops: PlanOrder[]; // in drive sequence
  totalWeightLbs: number;
  miles: number;
};

export type DayPlan = {
  date: string;
  orders: number;
  baselineTrucks: number;
  baselineMiles: number;
  routes: PlannedRoute[];
  plannedMiles: number;
  recoverable: number;
};

export type DispatchPlanResult = {
  days: DayPlan[];
  summary: {
    loads: number;
    trucksBefore: number;
    trucksAfter: number;
    milesBefore: number;
    milesAfter: number;
    recoverable: number;
  };
};

const MAX_STOPS_PER_ROUTE = 6;
const JOIN_RADIUS_MILES = 45; // don't chain stops across the whole corridor

type Unit = { stops: PlanOrder[]; weight: number; lat: number; lng: number };

export function buildDispatchPlan(orders: PlanOrder[], config: EngineConfig): DispatchPlanResult {
  const cap = config.vehicle_constraints.max_cargo_payload_lbs;
  const depot: [number, number] = [config.costs.depot.lat, config.costs.depot.lng];

  const byDate = new Map<string, PlanOrder[]>();
  for (const o of orders) {
    (byDate.get(o.date) ?? byDate.set(o.date, []).get(o.date)!).push(o);
  }

  const days: DayPlan[] = [];
  let truckSeq = 1;

  for (const [date, dayOrders] of Array.from(byDate.entries()).sort()) {
    // BASELINE: pack each wave independently (dispatch is blind to later waves).
    const byWave = new Map<string, PlanOrder[]>();
    for (const o of dayOrders) {
      (byWave.get(o.wave) ?? byWave.set(o.wave, []).get(o.wave)!).push(o);
    }
    let baselineTrucks = 0;
    let baselineMiles = 0;
    let baselineStops = 0;
    for (const waveOrders of byWave.values()) {
      const routes = pack(waveOrders, cap, depot);
      baselineTrucks += routes.length;
      baselineMiles += routes.reduce((a, r) => a + r.miles, 0);
      baselineStops += routes.reduce((a, r) => a + r.stops.length, 0);
    }

    // PLANNED: pack the whole day together.
    const packed = pack(dayOrders, cap, depot);
    const routes: PlannedRoute[] = packed.map((r) => ({
      ...r,
      truckId: `P-${String(truckSeq++).padStart(2, "0")}`,
    }));
    const plannedMiles = routes.reduce((a, r) => a + r.miles, 0);
    const plannedStops = routes.reduce((a, r) => a + r.stops.length, 0);

    const c = config.costs;
    const mileRate = c.cost_per_mile + c.fuel_surcharge_per_mile;
    const milesSaved = Math.max(0, baselineMiles - plannedMiles);
    const hoursSaved =
      milesSaved / c.avg_speed_mph +
      (Math.max(0, baselineStops - plannedStops) * c.service_time_minutes) / 60;
    const recoverable = round2(milesSaved * mileRate + hoursSaved * c.cost_per_fleet_hour);

    days.push({
      date,
      orders: dayOrders.length,
      baselineTrucks,
      baselineMiles: round1(baselineMiles),
      routes,
      plannedMiles: round1(plannedMiles),
      recoverable,
    });
  }

  const sum = {
    loads: orders.length,
    trucksBefore: days.reduce((a, d) => a + d.baselineTrucks, 0),
    trucksAfter: days.reduce((a, d) => a + d.routes.length, 0),
    milesBefore: round1(days.reduce((a, d) => a + d.baselineMiles, 0)),
    milesAfter: round1(days.reduce((a, d) => a + d.plannedMiles, 0)),
    recoverable: round2(days.reduce((a, d) => a + d.recoverable, 0)),
  };
  return { days, summary: sum };
}

/** Merge same-customer orders, then greedily pack into legal multi-stop routes. */
function pack(
  orders: PlanOrder[],
  cap: number,
  depot: [number, number],
): { stops: PlanOrder[]; totalWeightLbs: number; miles: number }[] {
  // Same customer always rides together (splitting only if over the cap).
  const byCustomer = new Map<string, PlanOrder[]>();
  for (const o of orders) {
    (byCustomer.get(o.customer) ?? byCustomer.set(o.customer, []).get(o.customer)!).push(o);
  }
  const units: Unit[] = [];
  for (const custOrders of byCustomer.values()) {
    let bundle: PlanOrder[] = [];
    let w = 0;
    for (const o of custOrders) {
      if (w + o.weightLbs > cap && bundle.length) {
        units.push(unitOf(bundle, w));
        bundle = [];
        w = 0;
      }
      bundle.push(o);
      w += o.weightLbs;
    }
    if (bundle.length) units.push(unitOf(bundle, w));
  }

  // Greedy routing: seed each truck with the farthest unassigned unit, then
  // keep adding the nearest unit that fits (weight, stop cap, join radius).
  const remaining = [...units];
  const routes: { stops: PlanOrder[]; totalWeightLbs: number; miles: number }[] = [];
  while (remaining.length) {
    let seedIdx = 0;
    let seedDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceMiles(depot, [remaining[i].lat, remaining[i].lng]);
      if (d > seedDist) {
        seedDist = d;
        seedIdx = i;
      }
    }
    const route: Unit[] = [remaining.splice(seedIdx, 1)[0]];
    let weight = route[0].weight;
    for (;;) {
      const last = route[route.length - 1];
      let bestIdx = -1;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const u = remaining[i];
        const stopCount = route.reduce((a, r) => a + r.stops.length, 0) + u.stops.length;
        if (weight + u.weight > cap || stopCount > MAX_STOPS_PER_ROUTE) continue;
        const d = distanceMiles([last.lat, last.lng], [u.lat, u.lng]);
        if (d <= JOIN_RADIUS_MILES && d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      const u = remaining.splice(bestIdx, 1)[0];
      route.push(u);
      weight += u.weight;
    }
    const stops = sequence(depot, route.flatMap((u) => u.stops));
    routes.push({ stops, totalWeightLbs: weight, miles: round1(tourMiles(depot, stops)) });
  }
  return routes;
}

function unitOf(stops: PlanOrder[], weight: number): Unit {
  return { stops, weight, lat: stops[0].lat, lng: stops[0].lng };
}

function sequence(depot: [number, number], stops: PlanOrder[]): PlanOrder[] {
  const rem = [...stops];
  const out: PlanOrder[] = [];
  let cur = depot;
  while (rem.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < rem.length; i++) {
      const d = distanceMiles(cur, [rem[i].lat, rem[i].lng]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const n = rem.splice(bi, 1)[0];
    out.push(n);
    cur = [n.lat, n.lng];
  }
  return out;
}

function tourMiles(depot: [number, number], stops: PlanOrder[]): number {
  let miles = 0;
  let cur = depot;
  for (const s of stops) {
    miles += distanceMiles(cur, [s.lat, s.lng]);
    cur = [s.lat, s.lng];
  }
  return miles + distanceMiles(cur, depot);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
