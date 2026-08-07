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
  groupId?: string;
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
  onOpenFinding,
}: {
  initialDate?: string;
  highlight?: FleetHighlight;
  onOpenFinding?: (groupId: string) => void;
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

  const weeks = useMemo(() => computeWeeks(data?.days ?? []), [data]);
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
          <h2 className="text-lg font-semibold text-ink">
            Every delivery your trucks made
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            This map shows every delivery your trucks made. Red routes are
            wasted trips that could have been combined with another truck. Click
            any route to see exactly what happened and what it cost.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <div className="text-xs text-ink-faint">Trucks used → needed</div>
              <div className="font-semibold text-ink">
                {data.trucksBefore} <span className="text-ink-faint">→</span>{" "}
                <span className="text-good">{data.trucksAfter}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink-faint">Miles driven → needed</div>
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
        {scope === "day" && data && (
          <select value={anchor} onChange={(e) => setAnchor(e.target.value)} className="!w-auto">
            {data.days.map((d) => (
              <option key={d} value={d}>
                {fmtDay(d)}
              </option>
            ))}
          </select>
        )}
        {scope === "week" && data && (
          <select
            value={weeks.find((w) => w.days.includes(anchor ?? ""))?.start ?? weeks[0]?.start ?? ""}
            onChange={(e) => setAnchor(e.target.value)}
            className="!w-auto"
          >
            {weeks.map((w) => (
              <option key={w.start} value={w.start}>
                {w.label}
              </option>
            ))}
          </select>
        )}
        {scope === "all" && data && data.days.length > 0 && (
          <span className="text-ink-muted">
            {fmtMD(data.days[0])} – {fmtMD(data.days[data.days.length - 1])},{" "}
            {data.days[0].slice(0, 4)}
          </span>
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
          <option value="all">All routes</option>
          <option value="candidate">Wasted trips only</option>
          <option value="suboptimal">Trucks with room to spare</option>
          <option value="clean">Efficient routes only</option>
        </select>
        <label className="flex items-center gap-1.5 text-ink-muted">
          <input
            type="checkbox"
            checked={candidatesOnly}
            onChange={(e) => setCandidatesOnly(e.target.checked)}
            className="!w-auto"
          />
          Show only the wasted trips
        </label>

        <div className="ml-auto">
          <button
            onClick={toggleMode}
            className={`btn ${mode === "after" ? "btn-primary" : "btn-ghost"}`}
          >
            {mode === "before"
              ? "See what should have happened instead"
              : "See what actually happened"}
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
              onOpenFinding={onOpenFinding}
              fitKey={fitKey}
              emphasize={emphasize}
            />
          )}
        </div>

        {/* mode badge */}
        <div className="pointer-events-none absolute left-4 top-4 z-[500]">
          <span className={`badge ${mode === "before" ? "badge-crimson" : "badge-green"} shadow-sm`}>
            {mode === "before"
              ? "What actually happened"
              : "What should have happened instead"}
          </span>
        </div>

        {/* route-color legend — the pattern-recognition key */}
        <div className="pointer-events-none absolute bottom-7 left-4 z-[500] rounded-lg border border-[var(--border)] bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          <div className="mb-1.5 text-[11px] font-semibold text-ink-faint">
            What the colors mean
          </div>
          <div className="space-y-1">
            <LegendRow color="#e6194b" label="Wasted trip — another truck was already going there" />
            <LegendRow color="#f58231" label="Truck ran with room to spare" />
            <LegendRow color="#2563eb" label="Efficient route — nothing to fix" />
          </div>
        </div>

        {selected && (
          <LanePanel route={selected} onClose={() => setSelectedKey(null)} />
        )}
      </div>
    </section>
  );
}

// "Mon Jul 20"
function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
// "Jul 20"
function fmtMD(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
// Group sorted ISO days into contiguous business-week runs (Fri->Mon gap = 3),
// labeled by their real range: "Week of Jul 20–24", "Week of Jul 28–Aug 1".
function computeWeeks(days: string[]): { start: string; end: string; label: string; days: string[] }[] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (let i = 0; i < days.length; i++) {
    if (cur.length === 0) cur = [days[i]];
    else {
      const prev = new Date(days[i - 1] + "T00:00:00Z").getTime();
      const now = new Date(days[i] + "T00:00:00Z").getTime();
      // gap of 1–2 days = same week; a Fri->Mon weekend gap (3) starts a new week
      if ((now - prev) / 86400000 < 3) cur.push(days[i]);
      else {
        runs.push(cur);
        cur = [days[i]];
      }
    }
  }
  if (cur.length) runs.push(cur);
  return runs.map((r) => {
    const start = r[0];
    const end = r[r.length - 1];
    const sameMonth = start.slice(5, 7) === end.slice(5, 7);
    const endLabel = sameMonth ? String(Number(end.slice(8, 10))) : fmtMD(end);
    return { start, end, days: r, label: `Week of ${fmtMD(start)}–${endLabel}` };
  });
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-[3px] w-5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] leading-tight text-ink-muted">{label}</span>
    </div>
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
        <Metric label="Miles driven" value={num(route.miles)} />
        <Metric label="Weight on truck" value={`${Math.round(route.totalWeight / 1000)}k lb`} />
        <Metric label="Room left" value={`${Math.round(route.remainingCapacity / 1000)}k lb`} />
      </div>

      <div className="mt-4 text-xs font-medium text-ink-faint">
        Deliveries in the order the truck made them
      </div>
      <ol className="mt-2 space-y-2">
        {route.stops.map((s, i) => (
          <li key={s.id} className="rounded-lg border border-[var(--border)] bg-surface-2 p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">
                {i + 1}. {s.customer}
              </span>
              {s.isCandidate && <span className="badge badge-crimson">wasted trip</span>}
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
