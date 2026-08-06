"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { fetchRoadRoute, type LatLng } from "@/lib/osrm";
import { money, num, shortDate } from "@/lib/format";
import type { ConsolidationFinding } from "@/lib/types";
import type { StopMarker } from "@/components/lane-map";

// Leaflet touches window, so load the map only in the browser.
const LaneMap = dynamic(() => import("@/components/lane-map"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

const ALERT = "#e6194b";
const GOOD = "#0a8a43";

type Rec = {
  id: string;
  lat: number | null;
  lng: number | null;
  customer_name: string | null;
  truck_id: string | null;
};

type Depot = { name: string; lat: number; lng: number };

type LaneRoutes = {
  before: LatLng[][];
  after: LatLng[][];
  stops: StopMarker[];
  roads: boolean;
  loading: boolean;
};

type SortKey = "cost" | "customer" | "date";

export function RouteMaps({
  findings,
  depot,
  records,
}: {
  findings: ConsolidationFinding[];
  depot: Depot;
  records: Rec[];
}) {
  const depotPos = useMemo<LatLng>(
    () => [depot.lat, depot.lng],
    [depot.lat, depot.lng],
  );
  const recordsById = useMemo(() => {
    const m = new Map<string, Rec>();
    for (const r of records) m.set(r.id, r);
    return m;
  }, [records]);

  const [sort, setSort] = useState<SortKey>("cost");
  const sorted = useMemo(() => sortFindings(findings, sort), [findings, sort]);

  const [selectedId, setSelectedId] = useState<string>(sorted[0]?.id ?? "");
  const selected =
    sorted.find((f) => f.id === selectedId) ?? sorted[0] ?? null;

  const [routes, setRoutes] = useState<LaneRoutes | null>(null);
  const cache = useRef(new Map<string, LaneRoutes>());

  useEffect(() => {
    if (!selected) return;
    const id = selected.id;
    const cached = cache.current.get(id);
    if (cached) {
      setRoutes(cached);
      return;
    }
    let cancelled = false;
    setRoutes({ before: [], after: [], stops: [], roads: true, loading: true });

    (async () => {
      const built = await buildLaneRoutes(selected, depotPos, recordsById);
      if (cancelled) return;
      cache.current.set(id, built);
      setRoutes(built);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, selected, depotPos, recordsById]);

  if (!selected) return null;

  const trucks = selected.consolidated_plan_json?.distinct_trucks ?? 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            What happened vs. what to do
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Pick a lane on the left. The left map is what ran that day; the right
            map is the consolidated version. Lines follow the road network; click
            a marker or lane for detail.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="!w-auto"
          >
            <option value="cost">Cost (high → low)</option>
            <option value="customer">Customer (A → Z)</option>
            <option value="date">Date</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
        {/* Lane list */}
        <div className="panel max-h-[560px] overflow-y-auto p-2">
          {sorted.map((f) => {
            const active = f.id === selected.id;
            return (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left transition ${
                  active
                    ? "bg-brand-600/10 ring-1 ring-brand-600/30"
                    : "hover:bg-black/5"
                }`}
              >
                <div className="truncate text-sm font-medium text-ink">
                  {f.customer_name}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-xs text-ink-muted">
                  <span>{shortDate(f.date)}</span>
                  <span className="font-semibold text-good">
                    {money(f.est_cost_usd)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Maps + detail */}
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <MapCard
              heading="Before — what ran"
              tone="alert"
              caption={`${trucks} trucks made separate trips`}
              metric={`${num(selected.wasted_miles)} wasted miles`}
            >
              {routes && !routes.loading ? (
                <LaneMap
                  depot={{ pos: depotPos, name: depot.name }}
                  stops={routes.stops}
                  routes={routes.before}
                  color={ALERT}
                />
              ) : (
                <MapSkeleton />
              )}
            </MapCard>

            <MapCard
              heading="After — consolidated"
              tone="good"
              caption="One truck covers the lane"
              metric="0 wasted miles"
            >
              {routes && !routes.loading ? (
                <LaneMap
                  depot={{ pos: depotPos, name: depot.name }}
                  stops={routes.stops}
                  routes={routes.after}
                  color={GOOD}
                />
              ) : (
                <MapSkeleton />
              )}
            </MapCard>
          </div>

          {routes && !routes.loading && !routes.roads && (
            <p className="text-xs text-ink-faint">
              Road routing was unavailable, so lines are shown straight between
              points.
            </p>
          )}

          <LaneDetail finding={selected} />
        </div>
      </div>
    </section>
  );
}

function LaneDetail({ finding }: { finding: ConsolidationFinding }) {
  const plan = finding.consolidated_plan_json;
  return (
    <div className="panel p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">{finding.customer_name}</h3>
        <span className="text-sm text-ink-muted">
          {shortDate(finding.date)} ·{" "}
          {plan?.type === "geo_cluster" ? "geo cluster" : "same customer"}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="Trucks" value={plan?.truck_ids?.join(" · ") ?? "—"} />
        <Stat label="Deliveries" value={String(plan?.delivery_count ?? "—")} />
        <Stat label="Wasted miles" value={num(finding.wasted_miles)} />
        <Stat label="Fleet-hours" value={num(finding.wasted_hours)} />
        <Stat label="Recoverable" value={money(finding.est_cost_usd)} accent />
        <Stat
          label="At 3PL rate"
          value={money(plan?.cost_3pl_benchmark)}
        />
        <Stat
          label="Redundant trucks"
          value={String(finding.duplicate_trucks ?? "—")}
        />
        <Stat label="Orders" value={String(plan?.order_ids?.length ?? "—")} />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm font-semibold ${accent ? "text-good" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function MapCard({
  heading,
  tone,
  caption,
  metric,
  children,
}: {
  heading: string;
  tone: "alert" | "good";
  caption: string;
  metric: string;
  children: React.ReactNode;
}) {
  const toneClass = tone === "alert" ? "text-alert" : "text-good";
  return (
    <div className="panel p-3">
      <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${toneClass}`}>
        {heading}
      </div>
      {children}
      <div className="mt-2 text-sm text-ink">{caption}</div>
      <div className={`text-sm font-semibold ${toneClass}`}>{metric}</div>
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="grid h-[340px] w-full place-items-center rounded-lg bg-surface-2 text-sm text-ink-faint">
      Loading map…
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function sortFindings(
  findings: ConsolidationFinding[],
  key: SortKey,
): ConsolidationFinding[] {
  const arr = [...findings];
  if (key === "cost")
    arr.sort((a, b) => (b.est_cost_usd ?? 0) - (a.est_cost_usd ?? 0));
  else if (key === "customer")
    arr.sort((a, b) =>
      (a.customer_name ?? "").localeCompare(b.customer_name ?? ""),
    );
  else arr.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return arr;
}

async function buildLaneRoutes(
  finding: ConsolidationFinding,
  depotPos: LatLng,
  recordsById: Map<string, Rec>,
): Promise<LaneRoutes> {
  const plan = finding.consolidated_plan_json;

  // Distinct stop locations for this lane, from the member orders.
  const seen = new Set<string>();
  const stops: StopMarker[] = [];
  for (const oid of plan?.order_ids ?? []) {
    const rec = recordsById.get(oid);
    if (!rec || rec.lat == null || rec.lng == null) continue;
    const key = `${rec.lat.toFixed(5)},${rec.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push({
      pos: [rec.lat, rec.lng],
      label: rec.customer_name ?? "Stop",
      sub: rec.truck_id ? `Truck ${rec.truck_id}` : undefined,
    });
  }
  // Fallback to the group centroid if we couldn't resolve member coords.
  if (stops.length === 0 && plan?.centroid) {
    stops.push({ pos: plan.centroid, label: finding.customer_name ?? "Stop" });
  }

  let roads = true;
  const straight = (a: LatLng, b: LatLng): LatLng[] => [a, b];

  // Before: one depot->stop trip per distinct stop (each a separate truck).
  const before: LatLng[][] = [];
  for (const s of stops) {
    const road = await fetchRoadRoute([depotPos, s.pos]);
    if (!road) roads = false;
    before.push(road ?? straight(depotPos, s.pos));
  }

  // After: a single consolidated loop depot -> stops -> depot.
  const loop: LatLng[] = [depotPos, ...stops.map((s) => s.pos), depotPos];
  const afterRoad = await fetchRoadRoute(loop);
  if (!afterRoad) roads = false;
  const after: LatLng[][] = [afterRoad ?? loop];

  return { before, after, stops, roads, loading: false };
}
