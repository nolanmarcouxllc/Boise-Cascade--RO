"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { money, num } from "@/lib/format";

const FleetLeaflet = dynamic(() => import("@/components/fleet-leaflet"), {
  ssr: false,
  loading: () => <div className="grid h-full w-full place-items-center bg-surface-2 text-sm text-ink-faint">Loading fleet map…</div>,
});

export type FleetStopView = {
  id: string;
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
};

export type RouteView = {
  key: string;
  truckId: string;
  date: string;
  stops: FleetStopView[];
  totalWeight: number;
  remainingCapacity: number;
  miles: number;
  hasCandidate: boolean;
  geometry: [number, number][];
};

type FleetResponse = {
  provider: string;
  scope: "day" | "week" | "all";
  anchorDate: string;
  days: string[];
  depot: { name: string; lat: number; lng: number };
  trucksBefore: number;
  trucksAfter: number;
  milesBefore: number;
  milesAfter: number;
  before: RouteView[];
  after: RouteView[];
};

type Scope = "day" | "week" | "all";
type Mode = "before" | "after";
type TypeFilter = "all" | "candidate" | "suboptimal" | "clean";

function typeOf(r: RouteView): TypeFilter {
  if (r.hasCandidate) return "candidate";
  if (r.remainingCapacity > 18000) return "suboptimal";
  return "clean";
}

export type FleetHighlight = { date: string; truckIds: string[]; groupId?: string } | null;

export function FleetMap({
  initialDate,
  highlight,
}: {
  initialDate?: string;
  highlight?: FleetHighlight;
}) {
  const [scope, setScope] = useState<Scope>("day");
  const [anchor, setAnchor] = useState<string | undefined>(initialDate);
  const [mode, setMode] = useState<Mode>("before");
  const [fading, setFading] = useState(false);
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // filters
  const [truck, setTruck] = useState<string>("all");
  const [customer, setCustomer] = useState<string>("all");
  const [typeF, setTypeF] = useState<TypeFilter>("all");
  const [candidatesOnly, setCandidatesOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedKey(null);
    (async () => {
      const res = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, date: anchor }),
      });
      if (!res.ok || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const body = (await res.json()) as FleetResponse;
      if (cancelled) return;
      setData(body);
      if (!anchor) setAnchor(body.anchorDate);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, anchor]);

  // When a finding is selected elsewhere, jump the map to that day + emphasize
  // the involved trucks, and show BEFORE (that's the state that has the waste).
  useEffect(() => {
    if (!highlight) return;
    setScope("day");
    setAnchor(highlight.date);
    setMode("before");
  }, [highlight]);
  const emphasize = useMemo(() => new Set(highlight?.truckIds ?? []), [highlight]);

  const routesForMode = useMemo(() => (data ? (mode === "before" ? data.before : data.after) : []), [data, mode]);

  const trucks = useMemo(() => Array.from(new Set(routesForMode.map((r) => r.truckId))).sort(), [routesForMode]);
  const customers = useMemo(
    () => Array.from(new Set(routesForMode.flatMap((r) => r.stops.map((s) => s.customer)))).sort(),
    [routesForMode],
  );

  const filtered = useMemo(
    () =>
      routesForMode.filter((r) => {
        if (candidatesOnly && !r.hasCandidate) return false;
        if (truck !== "all" && r.truckId !== truck) return false;
        if (typeF !== "all" && typeOf(r) !== typeF) return false;
        if (customer !== "all" && !r.stops.some((s) => s.customer === customer)) return false;
        return true;
      }),
    [routesForMode, candidatesOnly, truck, typeF, customer],
  );

  const toggleMode = useCallback(() => {
    setFading(true);
    setSelectedKey(null);
    setTimeout(() => {
      setMode((m) => (m === "before" ? "after" : "before"));
      setFading(false);
    }, 280);
  }, []);

  const selected = filtered.find((r) => r.key === selectedKey) ?? null;
  const fitKey = `${scope}:${anchor}:${mode}:${truck}:${customer}:${typeF}:${candidatesOnly}`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Full fleet map</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Every truck route for the period. Red routes pulse where a truck
            duplicated another&apos;s territory; amber ran with open capacity.
            Click a route or stop for detail.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-ink-faint">Trucks</div>
              <div className="font-semibold text-ink">
                {data.trucksBefore} <span className="text-ink-faint">→</span>{" "}
                <span className="text-good">{data.trucksAfter}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-ink-faint">Miles</div>
              <div className="font-semibold text-ink">
                {num(data.milesBefore)} <span className="text-ink-faint">→</span>{" "}
                <span className="text-good">{num(data.milesAfter)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
        <Segment
          value={scope}
          onChange={(v) => {
            setScope(v as Scope);
          }}
          options={[
            ["day", "Day"],
            ["week", "Week"],
            ["all", "All"],
          ]}
        />
        {scope !== "all" && data && (
          <select value={anchor} onChange={(e) => setAnchor(e.target.value)} className="!w-auto">
            {data.days.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <select value={truck} onChange={(e) => setTruck(e.target.value)} className="!w-auto">
          <option value="all">All trucks</option>
          {trucks.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} className="!w-auto max-w-[200px]">
          <option value="all">All customers</option>
          {customers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value as TypeFilter)} className="!w-auto">
          <option value="all">All route types</option>
          <option value="candidate">Waste candidates</option>
          <option value="suboptimal">Open capacity</option>
          <option value="clean">Clean runs</option>
        </select>
        <label className="flex items-center gap-1.5 text-ink-muted">
          <input
            type="checkbox"
            checked={candidatesOnly}
            onChange={(e) => setCandidatesOnly(e.target.checked)}
            className="!w-auto"
          />
          Candidates only
        </label>

        <div className="ml-auto">
          <button
            onClick={toggleMode}
            className={`btn ${mode === "after" ? "btn-primary" : "btn-ghost"}`}
          >
            {mode === "before" ? "Show optimized (After)" : "Show actual (Before)"}
          </button>
        </div>
      </div>

      {/* Map + side panel */}
      <div className="relative">
        <div
          className="overflow-hidden rounded-2xl border border-[var(--border)]"
          style={{ height: "70vh", minHeight: 600, opacity: fading ? 0.25 : 1, transition: "opacity .28s" }}
        >
          {loading || !data ? (
            <div className="grid h-full w-full place-items-center bg-surface-2 text-sm text-ink-faint">
              Building fleet routes…
            </div>
          ) : (
            <FleetLeaflet
              depot={data.depot}
              routes={filtered}
              selectedKey={selectedKey}
              onSelectRoute={setSelectedKey}
              fitKey={fitKey}
              emphasize={emphasize}
            />
          )}
        </div>

        {/* mode badge */}
        <div className="pointer-events-none absolute left-4 top-4 z-[500]">
          <span className={`badge ${mode === "before" ? "badge-crimson" : "badge-green"} shadow-sm`}>
            {mode === "before" ? "BEFORE — as dispatched" : "AFTER — consolidated"}
          </span>
        </div>

        {selected && (
          <LanePanel route={selected} onClose={() => setSelectedKey(null)} />
        )}
      </div>
    </section>
  );
}

function Segment({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${
            value === v ? "bg-brand-600 text-white" : "text-ink-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function LanePanel({ route, onClose }: { route: RouteView; onClose: () => void }) {
  return (
    <div className="absolute right-3 top-3 z-[500] max-h-[calc(70vh-24px)] w-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">Truck {route.truckId}</div>
          <div className="text-xs text-ink-muted">{route.date} · {route.stops.length} stops</div>
        </div>
        <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">✕</button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric label="Miles" value={num(route.miles)} />
        <Metric label="Load" value={`${Math.round(route.totalWeight / 1000)}k`} />
        <Metric label="Open" value={`${Math.round(route.remainingCapacity / 1000)}k`} />
      </div>

      <div className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-faint">Stops in order</div>
      <ol className="mt-2 space-y-2">
        {route.stops.map((s, i) => (
          <li key={s.id} className="rounded-lg border border-[var(--border)] bg-surface-2 p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">
                {i + 1}. {s.customer}
              </span>
              {s.isCandidate && <span className="badge badge-crimson">candidate</span>}
            </div>
            <div className="mt-0.5 text-xs text-ink-muted">
              {s.window ?? "—"} · {Math.round(s.weight).toLocaleString()} lb
              {s.orderNumber ? ` · ${s.orderNumber}` : ""}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-surface-2 p-2">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}
