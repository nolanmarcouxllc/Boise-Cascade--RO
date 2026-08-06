// Port of apps/engine/quantify.py -- wasted miles / fleet-hours / dollars.
// Each redundant truck is charged one depot->stop->depot out-and-back.

import type { EngineConfig } from "@/lib/config";
import { distanceMiles } from "@/lib/engine/geo";
import type { CandidateGroup } from "@/lib/engine/detect";
import type { ConsolidatedPlan, RunTotals } from "@/lib/types";

export type QuantifiedGroup = {
  group: CandidateGroup;
  redundant_trucks: number;
  leg_miles: number;
  wasted_miles: number;
  wasted_fleet_hours: number;
  cost_internal: number;
  cost_3pl_benchmark: number;
};

export type QuantifyResult = {
  groups: QuantifiedGroup[];
  totals: Omit<RunTotals, "records_analyzed" | "records_skipped_no_coords">;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function quantify(
  groups: CandidateGroup[],
  config: EngineConfig,
): QuantifyResult {
  const c = config.costs;
  const depot: [number, number] = [c.depot.lat, c.depot.lng];
  const serviceHours = c.service_time_minutes / 60;
  const mileRate = c.cost_per_mile + (c.fuel_surcharge_per_mile ?? 0);

  const out: QuantifiedGroup[] = groups.map((g) => {
    // Redundant trucks = trucks used minus the fewest that could legally have
    // carried the combined weight (weight-aware, from detect).
    const redundant = g.distinct_trucks - g.min_trucks_needed;
    const leg = distanceMiles(depot, g.centroid);
    const wastedMiles = redundant * 2 * leg;
    const wastedHours =
      (c.avg_speed_mph ? wastedMiles / c.avg_speed_mph : 0) +
      redundant * serviceHours;
    const costInternal =
      wastedMiles * mileRate + wastedHours * c.cost_per_fleet_hour;
    const cost3pl = wastedMiles * c.third_party_rate_per_mile;

    return {
      group: g,
      redundant_trucks: redundant,
      leg_miles: round2(leg),
      wasted_miles: round2(wastedMiles),
      wasted_fleet_hours: round2(wastedHours),
      cost_internal: round2(costInternal),
      cost_3pl_benchmark: round2(cost3pl),
    };
  });

  const sum = (f: (q: QuantifiedGroup) => number) =>
    round2(out.reduce((a, q) => a + f(q), 0));

  const truckVisitsBefore = out.reduce(
    (a, q) => a + q.group.distinct_trucks,
    0,
  );

  return {
    groups: out,
    totals: {
      candidate_groups: out.length,
      redundant_trucks: out.reduce((a, q) => a + q.redundant_trucks, 0),
      wasted_miles: sum((q) => q.wasted_miles),
      wasted_fleet_hours: sum((q) => q.wasted_fleet_hours),
      cost_internal: sum((q) => q.cost_internal),
      cost_3pl_benchmark: sum((q) => q.cost_3pl_benchmark),
      truck_visits_before: truckVisitsBefore,
      // after = fewest legal trucks per group (weight-aware), not always 1
      truck_visits_after: out.reduce((a, q) => a + q.group.min_trucks_needed, 0),
      truck_visits_eliminated:
        truckVisitsBefore -
        out.reduce((a, q) => a + q.group.min_trucks_needed, 0),
    },
  };
}

// Build the consolidated_plan_json payload for a findings row.
export function toPlan(q: QuantifiedGroup): ConsolidatedPlan {
  return {
    group_id: q.group.group_id,
    type: q.group.type,
    truck_ids: q.group.truck_ids,
    customer_names: q.group.customer_names,
    order_ids: q.group.order_ids.map(String),
    delivery_count: q.group.delivery_count,
    distinct_trucks: q.group.distinct_trucks,
    total_weight_lbs: q.group.total_weight_lbs,
    min_trucks_needed: q.group.min_trucks_needed,
    leg_miles: q.leg_miles,
    centroid: q.group.centroid,
    cost_3pl_benchmark: q.cost_3pl_benchmark,
  };
}
