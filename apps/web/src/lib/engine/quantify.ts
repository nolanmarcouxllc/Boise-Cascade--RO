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

  const out: QuantifiedGroup[] = groups.map((g) => {
    const redundant = g.distinct_trucks - 1;
    const leg = distanceMiles(depot, g.centroid);
    const wastedMiles = redundant * 2 * leg;
    const wastedHours =
      (c.avg_speed_mph ? wastedMiles / c.avg_speed_mph : 0) +
      redundant * serviceHours;
    const costInternal =
      wastedMiles * c.cost_per_mile + wastedHours * c.cost_per_fleet_hour;
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
      truck_visits_after: out.length, // one truck per group
      truck_visits_eliminated: truckVisitsBefore - out.length,
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
    leg_miles: q.leg_miles,
    centroid: q.group.centroid,
    cost_3pl_benchmark: q.cost_3pl_benchmark,
  };
}
