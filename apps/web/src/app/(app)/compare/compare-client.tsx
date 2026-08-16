"use client";

import { useRef, useState } from "react";
import { money, num, shortDate } from "@/lib/format";
import { parseDeliveryCsv, type DeliveryInsert } from "@/lib/engine/csv";
import { DemoMap, type DemoRoute } from "@/components/demo-map";

const RED = "#e6194b"; // "before" — every order on its own truck
const GREEN = "#0a8a43"; // "after" — orders combined onto shared trucks
const NEW_STOP = "#7c3aed"; // violet — the just-uploaded order

type StopView = {
  id: string;
  customer: string;
  address: string | null;
  orderNumber: string | null;
  weight: number;
  window: string | null;
  lat: number;
  lng: number;
  isNew?: boolean;
};
type NewOrderPlacement = {
  id: string;
  customer: string;
  weight: number;
  beforeTruck: string | null;
  afterTruck: string | null;
  consolidated: boolean;
  afterTruckStops: number;
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
  pcmilerConfigured: boolean;
  providerCounts: Record<string, number>;
  day: string;
  days: string[];
  depot: { name: string; lat: number; lng: number };
  before: SideView;
  after: SideView;
  savings: { trucks: number; miles: number; hours: number; cost: number };
  newOrders: NewOrderPlacement[];
  warnings: string[];
};

export function CompareClient() {
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string>("");
  const [orders, setOrders] = useState<DeliveryInsert[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(date: string | undefined, ordersArg: DeliveryInsert[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demo-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(date ? { date } : {}), orders: ordersArg }),
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

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ""; // allow re-uploading the same file
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseDeliveryCsv(text);
      if (parsed.rows.length === 0) {
        throw new Error("No order rows found in that file. Check it has a header row and at least one order.");
      }
      const merged = [...orders, ...parsed.rows];
      setOrders(merged);
      await run(day || undefined, merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setUploading(false);
    }
  }

  function clearOrders() {
    setOrders([]);
    run(day || undefined, []);
  }

  const busy = loading || uploading;

  return (
    <div className="space-y-6">
      {/* Control bar */}
      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <button
          onClick={() => run(data ? day : undefined, orders)}
          disabled={busy}
          className="btn btn-primary px-6 text-base"
        >
          {loading ? "Routing both plans…" : data ? "Run Comparison again" : "Run Comparison"}
        </button>

        {/* Upload an order from DMSi */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onUpload}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="btn btn-ghost"
        >
          {uploading ? "Adding order…" : "Upload Order from DMSi"}
        </button>

        {orders.length > 0 && (
          <button onClick={clearOrders} disabled={busy} className="text-sm text-ink-faint underline underline-offset-2 hover:text-ink">
            Clear uploaded {orders.length === 1 ? "order" : `${orders.length} orders`}
          </button>
        )}

        {data && (
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span>Delivery day:</span>
            <select
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                run(e.target.value, orders);
              }}
              disabled={busy}
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
          {busy
            ? "Sending both sets of orders to PC*MILER for real truck routing…"
            : data
              ? providerNote(data)
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

      {/* Where the uploaded order landed */}
      {data && data.newOrders.length > 0 && <NewOrderCallout placements={data.newOrders} />}

      {/* Geocoding / parse warnings */}
      {data && data.warnings.length > 0 && (
        <div className="rounded-xl border border-geo/30 bg-geo/10 px-4 py-3 text-sm text-geo">
          {data.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
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

// Honest routing status: distinguishes "PC*MILER drew the routes" from "key is
// missing" and from "key present but PC*MILER didn't respond, so we fell back".
function providerNote(data: CompareData): string {
  const day = shortDate(data.day);
  if (data.provider === "pcmiler") {
    return `Routed by PC*MILER (53-ft flatbed truck routing) · ${day}`;
  }
  const fallbackName = data.provider === "osrm" ? "the OSRM backup router" : "straight-line estimates";
  if (data.pcmilerConfigured) {
    return `PC*MILER didn't respond — routed by ${fallbackName} instead · ${day}`;
  }
  return `PC*MILER key not found on the server — routed by ${fallbackName} · ${day}`;
}

// Plain-English story of where each uploaded order ended up, before vs after.
function NewOrderCallout({ placements }: { placements: NewOrderPlacement[] }) {
  return (
    <div className="panel p-5" style={{ borderLeft: `4px solid ${NEW_STOP}` }}>
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: NEW_STOP }} />
        <span className="text-sm font-semibold text-ink">
          Your uploaded {placements.length === 1 ? "order" : "orders"} from DMSi
        </span>
      </div>
      <ul className="mt-3 space-y-2 text-sm text-ink-muted">
        {placements.map((p) => (
          <li key={p.id} className="leading-relaxed">
            <span className="font-medium text-ink">{p.customer}</span>{" "}
            <span className="text-ink-faint">({p.weight.toLocaleString()} lb)</span> —{" "}
            {p.consolidated ? (
              <>
                dispatch would send it out on its own truck{" "}
                <span className="font-medium text-ink">({p.beforeTruck})</span> today. Through the
                bridge it rides along on truck{" "}
                <span className="font-medium text-good">{p.afterTruck}</span> with{" "}
                {p.afterTruckStops - 1} {p.afterTruckStops - 1 === 1 ? "stop" : "stops"} already headed
                that way — <span className="font-medium text-good">no extra truck leaves the yard</span>.
              </>
            ) : (
              <>
                it still needs its own truck even through the bridge — no truck already headed that
                way could take it on without going over the legal 48,000 lb load.
              </>
            )}
          </li>
        ))}
      </ul>
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
      stops: r.stops.map((s) => ({ lat: s.lat, lng: s.lng, customer: s.customer, isNew: s.isNew })),
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
              {side.routes.map((r, i) => {
                const hasNew = r.stops.some((s) => s.isNew);
                return (
                  <li
                    key={`${r.truckId}:${i}`}
                    className="rounded-lg border bg-surface-2 p-3"
                    style={hasNew ? { borderColor: NEW_STOP, boxShadow: `0 0 0 1px ${NEW_STOP}` } : { borderColor: "var(--border)" }}
                  >
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
                          className="rounded-md border px-2 py-0.5 text-xs"
                          style={
                            s.isNew
                              ? { borderColor: NEW_STOP, backgroundColor: "rgba(124,58,237,0.10)", color: NEW_STOP, fontWeight: 600 }
                              : { borderColor: "var(--border)", backgroundColor: "#fff", color: "var(--ink-muted)" }
                          }
                        >
                          {s.isNew ? "★ " : ""}
                          {s.customer}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
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
