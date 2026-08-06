"""
report.py -- render results: a console/markdown before-after summary and a
folium map. Consumes the dict returned by quantify.quantify() plus the geocoded
DataFrame.

Outputs (into <output_dir>):
    summary.md   -- human-readable before/after with the dollar figure
    map.html     -- folium map: depot, all stops, candidate groups linked/colored
"""

from __future__ import annotations

import os

import folium


# A short rotating palette so each candidate group is visually distinct.
_PALETTE = [
    "#e6194b", "#3cb44b", "#f58231", "#4363d8", "#911eb4",
    "#008080", "#9a6324", "#800000", "#808000", "#000075",
]


def build(df, result: dict, config: dict, output_dir: str) -> dict:
    """Write summary.md and map.html. Returns {'summary_md','map_html','text'}."""
    os.makedirs(output_dir, exist_ok=True)
    text = _summary_text(result, config)

    md_path = os.path.join(output_dir, "summary.md")
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(text)

    map_path = os.path.join(output_dir, "map.html")
    _build_map(df, result, config, map_path)

    print(text)
    print(f"[report] wrote {md_path}")
    print(f"[report] wrote {map_path}")
    return {"summary_md": md_path, "map_html": map_path, "text": text}


def _money(v: float, cur: str = "USD") -> str:
    sym = "$" if cur == "USD" else ""
    return f"{sym}{v:,.2f}"


def _summary_text(result: dict, config: dict) -> str:
    t = result["totals"]
    r = result["rates"]
    cur = r["currency"]
    client = config.get("client", {}).get("name", "Client")
    groups = result["groups"]

    lines = []
    a = lines.append
    a(f"# Route Consolidation Diagnostic — {client}")
    a("")
    a("## Before → After")
    a("")
    a("| Metric | Before (today) | After (consolidated) | Delta |")
    a("| --- | ---: | ---: | ---: |")
    a(f"| Truck visits to flagged locations | {t['truck_visits_before']} | "
      f"{t['truck_visits_after']} | -{t['truck_visits_eliminated']} |")
    a(f"| Redundant truck-trips | {t['redundant_trucks']} | 0 | "
      f"-{t['redundant_trucks']} |")
    a(f"| Wasted miles | {t['wasted_miles']:,.1f} | 0 | "
      f"-{t['wasted_miles']:,.1f} |")
    a(f"| Wasted fleet-hours | {t['wasted_fleet_hours']:,.1f} | 0 | "
      f"-{t['wasted_fleet_hours']:,.1f} |")
    a("")
    a("## The number")
    a("")
    a(f"**Estimated recoverable cost: {_money(t['cost_internal'], cur)}** "
      f"(own-fleet cost of the redundant trips in this dataset).")
    a("")
    a(f"For comparison, the same wasted miles at the 3PL benchmark rate "
      f"({_money(r['third_party_rate_per_mile'], cur)}/mi) would run "
      f"{_money(t['cost_3pl_benchmark'], cur)}.")
    a("")
    a(f"Found **{t['candidate_groups']} consolidation candidate group(s)** — "
      f"same-day deliveries split across separate trucks that one truck could have carried.")
    a("")
    a("## Rate card used")
    a("")
    a(f"- Cost per mile: {_money(r['cost_per_mile'], cur)}")
    a(f"- Cost per fleet-hour: {_money(r['cost_per_fleet_hour'], cur)}")
    a(f"- 3PL benchmark: {_money(r['third_party_rate_per_mile'], cur)}/mi")
    a(f"- Avg speed: {r['avg_speed_mph']} mph · service time: {r['service_time_minutes']:.0f} min/stop")
    a(f"- Depot: {r['depot'].get('name','')} ({r['depot'].get('lat')}, {r['depot'].get('lng')})")
    a("")
    a("## Candidate detail")
    a("")
    if not groups:
        a("_No consolidation candidates found in this dataset._")
    else:
        a("| Group | Date | Type | Trucks | Deliveries | Wasted mi | Fleet-hrs | Cost |")
        a("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |")
        for g in groups:
            who = ", ".join(g["customer_names"])
            if len(who) > 40:
                who = who[:37] + "..."
            a(f"| {g['type']}: {who} | {g['date']} | {g['type']} | "
              f"{'/'.join(g['truck_ids'])} | {g['delivery_count']} | "
              f"{g['wasted_miles']:,.1f} | {g['wasted_fleet_hours']:,.1f} | "
              f"{_money(g['cost_internal'], cur)} |")
    a("")
    a("_Waste model: each redundant truck is charged one depot→stop→depot "
      "out-and-back. See quantify.py for the formula._")
    a("")
    return "\n".join(lines)


def _build_map(df, result: dict, config: dict, out_path: str) -> None:
    depot = result["rates"]["depot"]
    depot_pt = [float(depot["lat"]), float(depot["lng"])]

    placed = df[df["lat"].notna() & df["lng"].notna()]
    if not placed.empty:
        center = [placed["lat"].mean(), placed["lng"].mean()]
    else:
        center = depot_pt

    fmap = folium.Map(location=center, zoom_start=11, tiles="cartodbpositron")

    # Depot.
    folium.Marker(
        depot_pt,
        tooltip=f"DEPOT — {depot.get('name','')}",
        icon=folium.Icon(color="black", icon="home", prefix="fa"),
    ).add_to(fmap)

    # Map each candidate group_id to a color.
    group_color = {}
    for i, g in enumerate(result["groups"]):
        group_color[g["group_id"]] = _PALETTE[i % len(_PALETTE)]

    # All stops. Candidate stops get their group color + a connector to the centroid.
    for _, row in placed.iterrows():
        gid = row.get("candidate_group")
        pt = [float(row["lat"]), float(row["lng"])]
        label = (f"{row.get('customer_name','')} · {row.get('truck_id','')} · "
                 f"{str(row.get('date'))[:10]} · order {row.get('order_id','')}")
        if gid and gid in group_color:
            color = group_color[gid]
            folium.CircleMarker(
                pt, radius=7, color=color, fill=True, fill_opacity=0.9,
                tooltip=f"CANDIDATE — {label}",
            ).add_to(fmap)
        else:
            folium.CircleMarker(
                pt, radius=4, color="#888888", fill=True, fill_opacity=0.6,
                tooltip=label,
            ).add_to(fmap)

    # Draw each group: centroid star + spokes to its members, plus depot leg.
    for g in result["groups"]:
        color = group_color[g["group_id"]]
        cen = [g["centroid"][0], g["centroid"][1]]
        members = df.loc[df["candidate_group"] == g["group_id"]]
        for _, m in members.iterrows():
            folium.PolyLine([cen, [float(m["lat"]), float(m["lng"])]],
                            color=color, weight=2, opacity=0.7).add_to(fmap)
        # Dashed line depot -> group, the redundant leg being paid for.
        folium.PolyLine([depot_pt, cen], color=color, weight=2,
                        opacity=0.5, dash_array="6").add_to(fmap)
        folium.Marker(
            cen,
            tooltip=(f"{g['type']} · {g['distinct_trucks']} trucks · "
                     f"${g['cost_internal']:,.0f} · {g['wasted_miles']:.1f} wasted mi"),
            icon=folium.Icon(color="red", icon="exclamation", prefix="fa"),
        ).add_to(fmap)

    fmap.save(out_path)
