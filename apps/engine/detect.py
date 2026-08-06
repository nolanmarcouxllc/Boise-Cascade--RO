"""
detect.py -- flag consolidation candidates.

A candidate group is a set of deliveries on the SAME day, hitting the same
place, that were split across MORE THAN ONE truck -- i.e. they could have
ridden a single truck. Two flavors:

  same_customer : identical customer_id, same day, >= min_trucks trucks
  geo_cluster   : different customers whose stops fall within cluster_radius
                  of each other, same day, >= min_trucks trucks

Output:
  - the DataFrame annotated with `candidate_group` and `candidate_type`
  - a list of group dicts (the unit quantify.py and report.py consume)
"""

from __future__ import annotations

import math

import pandas as pd

from geocode import distance_miles


def find_candidates(df: pd.DataFrame, config: dict):
    """Return (annotated_df, groups). `groups` is a list of dicts."""
    det = config.get("detection", {})
    min_trucks = int(det.get("min_trucks", 2))
    radius = float(det.get("cluster_radius_miles", 0.5))
    do_customer = bool(det.get("same_customer", True))
    do_geo = bool(det.get("geo_cluster", True))
    max_load = float(det.get("max_load_lbs", 0)) or None  # None = no weight gate

    work = df.copy().reset_index(drop=True)
    work["candidate_group"] = None
    work["candidate_type"] = None

    # Only rows we can actually place on a map and date participate.
    usable = work[work["date"].notna() & work["lat"].notna() & work["lng"].notna()]

    groups: list[dict] = []

    for day, day_df in usable.groupby(work["date"].dt.date):
        claimed: set[int] = set()  # row indices already in a same-customer group

        # --- same-customer duplicates ------------------------------------
        if do_customer:
            for cust_id, cust_df in day_df.groupby("customer_id"):
                trucks = cust_df["truck_id"].nunique()
                if trucks >= min_trucks and _weight_feasible(cust_df, trucks, max_load):
                    idx = list(cust_df.index)
                    gid = f"{day}|CUST|{cust_id}"
                    _assign(work, idx, gid, "same_customer")
                    claimed.update(idx)
                    groups.append(_summarize(work, idx, gid, "same_customer", day, max_load))

        # --- geo clusters (over rows not already claimed) ----------------
        if do_geo:
            remaining = day_df.drop(index=[i for i in claimed if i in day_df.index])
            for members in _cluster_by_distance(remaining, radius):
                sub = work.loc[members]
                trucks = sub["truck_id"].nunique()
                if trucks >= min_trucks and _weight_feasible(sub, trucks, max_load):
                    gid = f"{day}|GEO|{len(groups)}"
                    _assign(work, members, gid, "geo_cluster")
                    groups.append(_summarize(work, members, gid, "geo_cluster", day, max_load))

    print(f"[detect] found {len(groups)} consolidation candidate group(s): "
          f"{sum(g['type'] == 'same_customer' for g in groups)} same-customer, "
          f"{sum(g['type'] == 'geo_cluster' for g in groups)} geo-cluster.")
    return work, groups


def _assign(df: pd.DataFrame, idx, gid: str, kind: str) -> None:
    df.loc[idx, "candidate_group"] = gid
    df.loc[idx, "candidate_type"] = kind


def _min_trucks_needed(sub: pd.DataFrame, max_load: float | None) -> int:
    """Fewest legal trucks that could carry the group's combined weight."""
    if not max_load:
        return 1
    total = float(sub["weight_lbs"].fillna(0).sum()) if "weight_lbs" in sub else 0.0
    return max(1, math.ceil(total / max_load))


def _weight_feasible(sub: pd.DataFrame, distinct_trucks: int, max_load: float | None) -> bool:
    """A split is waste only if FEWER trucks could legally have carried it.
    Two trucks hauling a combined 74k lbs is correct dispatch, not a candidate."""
    return distinct_trucks > _min_trucks_needed(sub, max_load)


def _cluster_by_distance(day_df: pd.DataFrame, radius_miles: float):
    """Greedy single-link clustering by geodesic distance.

    Fine for Phase 0 volumes (a day's stops). Returns a list of index-lists,
    one per cluster that has at least two stops."""
    points = list(day_df.index)
    coords = {i: (day_df.at[i, "lat"], day_df.at[i, "lng"]) for i in points}
    unseen = set(points)
    clusters = []

    while unseen:
        seed = unseen.pop()
        cluster = [seed]
        frontier = [seed]
        # Grow the cluster: anything within radius of a member joins.
        while frontier:
            cur = frontier.pop()
            for other in list(unseen):
                if distance_miles(coords[cur], coords[other]) <= radius_miles:
                    unseen.remove(other)
                    cluster.append(other)
                    frontier.append(other)
        if len(cluster) >= 2:
            clusters.append(cluster)
    return clusters


def _summarize(df: pd.DataFrame, idx, gid: str, kind: str, day,
               max_load: float | None = None) -> dict:
    """Build the group record used downstream."""
    sub = df.loc[idx]
    lat = float(sub["lat"].mean())   # centroid -- representative stop location
    lng = float(sub["lng"].mean())
    total_w = float(sub["weight_lbs"].fillna(0).sum()) if "weight_lbs" in sub else 0.0
    return {
        "group_id": gid,
        "date": str(day),
        "type": kind,
        "customer_ids": sorted(sub["customer_id"].unique().tolist()),
        "customer_names": sorted(sub["customer_name"].unique().tolist()),
        "truck_ids": sorted(sub["truck_id"].unique().tolist()),
        "order_ids": sub["order_id"].tolist(),
        "delivery_count": int(len(sub)),
        "distinct_trucks": int(sub["truck_id"].nunique()),
        "total_weight_lbs": total_w,
        "min_trucks_needed": _min_trucks_needed(sub, max_load),
        "centroid": (lat, lng),
        "row_index": list(idx),
    }
