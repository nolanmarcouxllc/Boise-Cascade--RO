"use client";

import { useState } from "react";
import { money, num, shortDate } from "@/lib/format";
import { DemoMap, type DemoRoute } from "@/components/demo-map";

const RED = "#e6194b"; // "before" — every order on its own truck
const GREEN = "#0a8a43"; // "after" — orders combined onto shared trucks

type StopView = {
  id: string;
  customer: string;
  address: string | null;
  orderNumber: string | null;
  weight: number;
  window: string | null;
  lat: number;
  lng: number;
};
type RouteView = {
  truckId: string;
  stops: StopView[];
  weight: number;
  miles: number;
  hours: number;
  cost: number;
  geometry: [number, number][];
};
type SideView = {
  totalRoutes: number;
  totalStops: number;
  totalMiles: number;
  totalHours: number;
  totalCost: number;
  routes: RouteView[];
};
type CompareData = {
  provider: string;
  day: string;
  days: string[];
  depot: { name: string; lat: number; lng: number };
  before: SideView;
  after: SideView;
  savings: { trucks: number; miles: number; hours: number; cost: number };
};

export function CompareClient() {
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string>("");

  async function run(date?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demo-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(date ? { date } : {}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not run the comparison.");
      setData(body as CompareData);
      setDay(body.day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Control bar */}
      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <button
          onClick={() => run(data ? day : undefined)}
          disabled={loading}
          className="btn btn-primary px-6 text-base"
        >
          {loading ? "Routing both plans…" : data ? "Run Comparison again" : "Run Comparison"}
        </button>

        {data && (
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span>Delivery day:</span>
            <select
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                run(e.target.value);
              }}
              disabled={loading}
              className="!w-auto"
            >
              {data.days.map((d) => (
                <option key={d} value={d}>
                  {shortDate(d)}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="text-sm text-ink-faint">
          {loading
            ? "Sending both sets of orders to PC*MILER for real truck routing…"
            : data
              ? `Routed by ${data.provider === "pcmiler" ? "PC*MILER (53-ft flatbed truck routing)" : "the fallback router"} · ${shortDate(data.day)}`
              : "Click to route today's orders both ways and see the difference side by side."}
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-alert/30 bg-alert/10 px-4 py-3 text-sm text-alert">
          {error}
        </p>
      )}

      {/* Savings headline */}
      {data && (
        <div className="panel border-brand-200 bg-gradient-to-b from-brand-50 to-white p-5">
          <div className="text-sm font-medium text-ink-muted">
            What combining these orders would have saved on this one day
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <Headline value={money(data.savings.cost)} label="less to run the trucks" tone="good" />
            <Headline value={String(data.savings.trucks)} label="fewer trucks on the road" tone="good" />
            <Headline value={`${num(data.savings.miles)} mi`} label="fewer miles driven" tone="good" />
          </div>
        </div>
      )}

      {/* Two columns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Column
          kind="before"
          title="Without the Bridge"
          subtitle="Raw orders sent straight to PC*MILER — the way dispatch runs today, with each order riding on its own truck."
          side={data?.before ?? null}
          depot={data?.depot ?? null}
          day={data?.day ?? ""}
          loading={loading}
          color={RED}
        />
        <Column
          kind="after"
          title="Through the Bridge"
          subtitle="The same orders combined onto shared trucks first, then sent to PC*MILER — no delivery is dropped, they just share the ride."
          side={data?.after ?? null}
          depot={data?.depot ?? null}
          day={data?.day ?? ""}
          loading={loading}
          color={GREEN}
        />
      </div>
    </div>
  );
}

function Headline({ value, label, tone }: { value: string; label: string; tone?: "good" }) {
  return (
    <div>
      <span className={`text-3xl font-semibold tracking-tight ${tone === "good" ? "text-good" : "text-ink"}`}>
        {value}
      </span>{" "}
      <span className="text-sm text-ink-muted">{label}</span>
    </div>
  );
}

function Column({
  kind,
  title,
  subtitle,
  side,
  depot,
  day,
  loading,
  color,
}: {
  kind: "before" | "after";
  title: string;
  subtitle: string;
  side: SideView | null;
  depot: { name: string; lat: number; lng: number } | null;
  day: string;
  loading: boolean;
  color: string;
}) {
  const routes: DemoRoute[] =
    side?.routes.map((r) => ({
      truckId: r.truckId,
      geometry: r.geometry,
      stops: r.stops.map((s) => ({ lat: s.lat, lng: s.lng, customer: s.customer })),
    })) ?? [];

  return (
    <section className="panel overflow-hidden">
      <div
        className="border-b border-[var(--border)] px-5 py-4"
        style={{ borderTop: `3px solid ${color}` }}
      >
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
      </div>

      <div className="p-5">
        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Trucks sent out" value={side ? String(side.totalRoutes) : "—"} sub="separate trips leaving the yard" />
          <Stat label="Total miles driven" value={side ? num(side.totalMiles) : "—"} sub="real routed road miles" />
          <Stat label="Estimated cost to run them" value={side ? money(side.totalCost) : "—"} sub="fuel, mileage & drive time" />
        </div>

        {/* Map */}
        <div className="mt-5">
          {depot && side ? (
            <DemoMap depot={depot} routes={routes} color={color} fitKey={`${kind}:${day}`} />
          ) : (
            <div className="grid h-[340px] place-items-center rounded-xl border border-dashed border-[var(--border-strong)] bg-surface-2 text-sm text-ink-faint">
              {loading ? "Drawing routes…" : "Run the comparison to see the routes on the map."}
            </div>
          )}
        </div>

        {/* Stop list, grouped by truck */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-ink-faint">
            <span>Delivery stops, grouped by truck</span>
            {side && <span>{side.totalStops} stops across {side.totalRoutes} trucks</span>}
          </div>
          {side ? (
            <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {side.routes.map((r, i) => (
                <li key={`${r.truckId}:${i}`} className="rounded-lg border border-[var(--border)] bg-surface-2 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink">Truck {r.truckId}</span>
                    <span className="text-xs text-ink-muted">
                      {r.stops.length} stop{r.stops.length === 1 ? "" : "s"} · {Math.round(r.weight / 1000)}k lb · {num(r.miles)} mi · {money(r.cost)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.stops.map((s) => (
                      <span
                        key={s.id}
                        title={`${s.customer}${s.orderNumber ? ` · order ${s.orderNumber}` : ""} · ${s.weight.toLocaleString()} lb`}
                        className="rounded-md border border-[var(--border)] bg-white px-2 py-0.5 text-xs text-ink-muted"
                      >
                        {s.customer}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface-2 p-6 text-center text-sm text-ink-faint">
              No routes yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-2 p-3">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-ink-faint">{sub}</div>
    </div>
  );
}
