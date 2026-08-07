"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { money, num, shortDate } from "@/lib/format";

const DrawerMap = dynamic(() => import("@/components/drawer-map"), {
  ssr: false,
  loading: () => <div className="grid h-[220px] place-items-center rounded-lg bg-surface-2 text-xs text-ink-faint">Loading…</div>,
});

const TRUCK_COLORS = ["#e6194b", "#4363d8", "#f58231", "#911eb4", "#008080", "#9a6324"];
const GOOD = "#0a8a43";

type Detail = {
  id: string;
  customer: string;
  date: string;
  type: "same_customer" | "geo_cluster";
  truckIds: string[];
  distinctTrucks: number;
  minTrucksNeeded: number;
  combinedGroupWeightLbs: number;
  maxLoadLbs: number;
  legal: boolean;
  waves: { window: string; count: number }[];
  manifest: {
    truckId: string;
    dayWeightLbs: number;
    remainingCapacityLbs: number;
    stops: { orderNumber: string | null; customer: string | null; weightLbs: number; window: string | null; inGroup: boolean }[];
  }[];
  numbers: {
    wastedMiles: number; wastedHours: number; recoverable: number; cost3pl: number;
    milesContext: string; loadFactorBefore: number; loadFactorAfter: number;
  };
  depot: { name: string; lat: number; lng: number };
  before: { truckId: string; stops: { id: string; customer: string | null; lat: number; lng: number }[]; geometry: [number, number][] }[];
  after: { stops: { id: string; customer: string | null; lat: number; lng: number }[]; geometry: [number, number][] };
};

export function FindingDrawer({ findingId, onClose }: { findingId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setSendResult(null);
    (async () => {
      const res = await fetch(`/api/findings/${findingId}`, { method: "POST" });
      if (!res.ok || cancelled) { if (!cancelled) setLoading(false); return; }
      const body = (await res.json()) as Detail;
      if (!cancelled) { setDetail(body); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [findingId]);

  async function sendToDmsi() {
    if (!detail) return;
    const ok = window.confirm(
      "Send this consolidated plan to DMSi dispatch?\n\n" +
        "Simulation mode logs the exact payload without touching production. " +
        "Set DMSI_LIVE_MODE=true to send for real.",
    );
    if (!ok) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/integrations/dmsi/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: detail.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Send failed");
      setSendResult(`${body.mode === "live" ? "Sent to DMSi" : "Simulated"} — ${body.message}`);
    } catch (e) {
      setSendResult(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="panel mt-3 p-5">
      {loading || !detail ? (
        <div className="py-10 text-center text-sm text-ink-faint">Loading finding detail…</div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-ink">{detail.customer}</h3>
              <p className="text-sm text-ink-muted">
                {shortDate(detail.date)} · {detail.type === "geo_cluster" ? "geo cluster" : "same customer"} ·{" "}
                {detail.distinctTrucks} trucks deployed
              </p>
            </div>
            <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">✕</button>
          </div>

          {/* WHY */}
          <Section title="Why this happened">
            <p className="text-sm leading-relaxed text-ink-muted">{whyText(detail)}</p>
          </Section>

          {/* WHAT WAS ON EACH TRUCK */}
          <Section title="What was on each truck">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {detail.manifest.map((m, i) => (
                <div key={m.truckId} className="rounded-lg border border-[var(--border)] bg-surface-2 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style={{ color: TRUCK_COLORS[i % TRUCK_COLORS.length] }}>
                      Truck {m.truckId}
                    </span>
                    <span className="text-xs text-ink-faint">{Math.round(m.remainingCapacityLbs / 1000)}k open</span>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                    {m.stops.map((s, j) => (
                      <li key={j} className={s.inGroup ? "font-medium text-ink" : ""}>
                        {s.customer} · {Math.round(s.weightLbs).toLocaleString()} lb · {s.window}
                        {s.inGroup ? " ◄" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm">
              Combined group load{" "}
              <span className="font-semibold text-ink">{detail.combinedGroupWeightLbs.toLocaleString()} lb</span> vs{" "}
              {detail.maxLoadLbs.toLocaleString()} lb legal —{" "}
              <span className={`badge ${detail.legal ? "badge-green" : "badge-crimson"}`}>
                {detail.legal ? "fits one truck legally" : "requires split (legal)"}
              </span>
            </p>
          </Section>

          {/* EMBEDDED MAPS */}
          <Section title="Before → after routes">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-alert">Before — every truck&apos;s full day</div>
                <DrawerMap
                  depot={detail.depot}
                  routes={detail.before.map((b, i) => ({ geometry: b.geometry, color: TRUCK_COLORS[i % TRUCK_COLORS.length] }))}
                  stops={detail.before.flatMap((b, i) => b.stops.map((s) => ({ lat: s.lat, lng: s.lng, color: TRUCK_COLORS[i % TRUCK_COLORS.length], label: s.customer ?? "" })))}
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-good">After — one consolidated truck</div>
                <DrawerMap
                  depot={detail.depot}
                  routes={[{ geometry: detail.after.geometry, color: GOOD }]}
                  stops={detail.after.stops.map((s) => ({ lat: s.lat, lng: s.lng, color: GOOD, label: s.customer ?? "" }))}
                />
              </div>
            </div>
          </Section>

          {/* NUMBERS */}
          <Section title="The numbers">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label="Wasted miles" value={num(detail.numbers.wastedMiles)} hint={detail.numbers.milesContext} />
              <Num label="Wasted fleet-hrs" value={num(detail.numbers.wastedHours)} />
              <Num label="Recoverable" value={money(detail.numbers.recoverable)} accent />
              <Num label="At 3PL rate" value={money(detail.numbers.cost3pl)} />
              <Num label="Load factor before" value={`${detail.numbers.loadFactorBefore}%`} />
              <Num label="Load factor after" value={`${detail.numbers.loadFactorAfter}%`} />
            </div>
          </Section>

          {/* SEND */}
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
            <button onClick={sendToDmsi} disabled={sending} className="btn btn-primary">
              {sending ? "Sending…" : "Send to DMSi dispatch"}
            </button>
            {sendResult && <span className="text-sm text-ink-muted">{sendResult}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function whyText(d: Detail): string {
  const parts = d.waves.map((w) => `${w.count} order(s) at ${w.window}`).join(", then ");
  if (d.type === "geo_cluster") {
    return `DMSi released ${parts} to customers in the same area. Dispatch built the ${d.waves[0]?.window ?? "first"} routes blind to the later release, so a second truck went to the same neighborhood a wave-1 truck could have covered with open capacity.`;
  }
  return `DMSi released ${parts} to ${d.customer}. Dispatch built the ${d.waves[0]?.window ?? "first"} routes before the later orders released, so ${d.distinctTrucks} separate trucks were sent to the same customer when ${d.minTrucksNeeded} could have carried the combined ${d.combinedGroupWeightLbs.toLocaleString()} lb legally.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</div>
      {children}
    </div>
  );
}

function Num({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-surface-2 p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${accent ? "text-good" : "text-ink"}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] leading-tight text-ink-faint">{hint}</div>}
    </div>
  );
}
