"""
quantify.py -- turn candidate groups into wasted miles, fleet-hours, and dollars.

Waste model (Phase 0, deliberately simple and defensible)
---------------------------------------------------------
For a candidate group served by N distinct trucks, one truck was enough. The
other (N-1) trucks each made a separate out-and-back from the depot to reach the
same place. Consolidating removes those redundant out-and-backs.

  redundant_trucks   = distinct_trucks - 1
  leg_miles          = geodesic(depot, group centroid)
  wasted_miles       = redundant_trucks * 2 * leg_miles          # there & back
  wasted_fleet_hours = wasted_miles / avg_speed_mph
                       + redundant_trucks * (service_time_minutes / 60)
  cost_internal      = wasted_miles * cost_per_mile
                       + wasted_fleet_hours * cost_per_fleet_hour
  cost_3pl_benchmark = wasted_miles * third_party_rate_per_mile

`cost_internal` is the primary savings number (what it costs Boise Cascade to run
the redundant trips on their own fleet). `cost_3pl_benchmark` is a reference point:
what those same miles would cost at the 3PL rate.
"""

from __future__ import annotations

from geocode import distance_miles


def quantify(groups: list[dict], config: dict) -> dict:
    """Return {'groups': [...per-group metrics...], 'totals': {...}, 'rates': {...}}."""
    costs = config.get("costs", {})
    depot = costs.get("depot", {})
    depot_pt = (float(depot["lat"]), float(depot["lng"]))

    cost_per_mile = float(costs.get("cost_per_mile", 0.0))
    cost_per_hour = float(costs.get("cost_per_fleet_hour", 0.0))
    tpl_per_mile = float(costs.get("third_party_rate_per_mile", 0.0))
    avg_speed = float(costs.get("avg_speed_mph", 30.0))
    service_hours = float(costs.get("service_time_minutes", 0.0)) / 60.0

    per_group = []
    for g in groups:
        redundant = g["distinct_trucks"] - 1
        leg_miles = distance_miles(depot_pt, g["centroid"])
        wasted_miles = redundant * 2.0 * leg_miles
        wasted_hours = (wasted_miles / avg_speed if avg_speed else 0.0) + redundant * service_hours
        cost_internal = wasted_miles * cost_per_mile + wasted_hours * cost_per_hour
        cost_3pl = wasted_miles * tpl_per_mile

        per_group.append({
            **g,
            "redundant_trucks": redundant,
            "leg_miles": round(leg_miles, 2),
            "wasted_miles": round(wasted_miles, 2),
            "wasted_fleet_hours": round(wasted_hours, 2),
            "cost_internal": round(cost_internal, 2),
            "cost_3pl_benchmark": round(cost_3pl, 2),
        })

    totals = {
        "candidate_groups": len(per_group),
        "redundant_trucks": sum(x["redundant_trucks"] for x in per_group),
        "wasted_miles": round(sum(x["wasted_miles"] for x in per_group), 2),
        "wasted_fleet_hours": round(sum(x["wasted_fleet_hours"] for x in per_group), 2),
        "cost_internal": round(sum(x["cost_internal"] for x in per_group), 2),
        "cost_3pl_benchmark": round(sum(x["cost_3pl_benchmark"] for x in per_group), 2),
        # before/after in truck-visits to the flagged locations
        "truck_visits_before": sum(x["distinct_trucks"] for x in per_group),
        "truck_visits_after": len(per_group),  # one truck per group
    }
    totals["truck_visits_eliminated"] = totals["truck_visits_before"] - totals["truck_visits_after"]

    rates = {
        "cost_per_mile": cost_per_mile,
        "cost_per_fleet_hour": cost_per_hour,
        "third_party_rate_per_mile": tpl_per_mile,
        "avg_speed_mph": avg_speed,
        "service_time_minutes": float(costs.get("service_time_minutes", 0.0)),
        "currency": costs.get("currency", "USD"),
        "depot": depot,
    }

    print(f"[quantify] wasted {totals['wasted_miles']} mi, "
          f"{totals['wasted_fleet_hours']} fleet-hrs, "
          f"${totals['cost_internal']:,.2f} internal "
          f"(${totals['cost_3pl_benchmark']:,.2f} at 3PL rate).")
    return {"groups": per_group, "totals": totals, "rates": rates}
