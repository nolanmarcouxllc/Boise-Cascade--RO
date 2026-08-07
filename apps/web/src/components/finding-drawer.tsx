"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { money, num, shortDate } from "@/lib/format";

const DrawerMap = dynamic(() => import("@/components/drawer-map"), {
  ssr: false,
  loading: () => <div className="grid h-[200px] place-items-center rounded-lg bg-surface-2 text-xs text-ink-faint">Loading…</div>,
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
  duplicateTrucks: number;
  combinedGroupWeightLbs: number;
  maxLoadLbs: number;
  legal: boolean;
  waves: { window: string; count: number }[];
  manifest: {
    truckId: string;
    dayWeightLbs: number;
    remainingCapacityLbs: number;
    stops: {
      orderNumber: string | null; customer: string | null; weightLbs: number; window: string | null; inGroup: boolean;
      product: string | null; quantity: number | null; unit: string | null; boardFeet: number | null;
    }[];
  }[];
  billOfLading: {
    order_number: string; customer: string | null; product: string | null;
    quantity: number | null; unit: string | null; board_feet: number | null; weight_lbs: number | null;
  }[];
  numbers: {
    wastedMiles: number; wastedHours: number; recoverable: number; cost3pl: number;
    milesContext: string; loadFactorBefore: number; loadFactorAfter: number;
  };
  depot: { name: string; lat: number; lng: number };
  before: { truckId: string; stops: { id: string; customer: string | null; lat: number; lng: number }[]; geometry: [number, number][] }[];
  after: { stops: { id: string; customer: string | null; lat: number; lng: number }[]; geometry: [number, number][] };
};

/**
 * The one consistent detail panel. Slides in from the right, reachable from
 * every entry point on the dashboard (findings row, map route, map stop). Always
 * shows the complete picture for a finding: verdict, why, per-truck manifest,
 * before/after maps, the numbers with context, and Send to DMSi.
 */
export function FindingPanel({ findingId, onClose }: { findingId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const open = !!findingId;

  useEffect(() => {
    if (!findingId) return;
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

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function sendToDmsi() {
    if (!detail) return;
    const ok = window.confirm(
      "Send this consolidated plan to DMSi dispatch?\n\nSimulation mode logs the exact payload without touching production. Set DMSI_LIVE_MODE=true to send for real.",
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
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-[1000] bg-black/25 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-label="Finding detail"
        className={`fixed right-0 top-0 z-[1001] flex h-full w-full max-w-[540px] flex-col bg-white shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <span className="text-sm font-semibold text-ink">{detail?.customer ?? "Finding detail"}</span>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-ink-faint hover:bg-black/5 hover:text-ink" aria-label="Close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading || !detail ? (
            <div className="py-10 text-center text-sm text-ink-faint">Loading finding detail…</div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-sm text-ink-muted">
                  {shortDate(detail.date)} · {detail.type === "geo_cluster" ? "geo cluster" : "same customer"} ·{" "}
                  {detail.distinctTrucks} trucks deployed
                </p>
                {/* one-line verdict */}
                <div className="mt-2 rounded-lg border border-good/30 bg-good/10 p-3 text-sm font-medium text-good">
                  {verdict(detail)}
                </div>
              </div>

              <Section title="Why this happened">
                <p className="text-sm leading-relaxed text-ink-muted">{whyText(detail)}</p>
              </Section>

              <Section title="What was on each truck">
                <div className="grid gap-3 sm:grid-cols-2">
                  {detail.manifest.map((m, i) => (
                    <div key={m.truckId} className="rounded-lg border border-[var(--border)] bg-surface-2 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold" style={{ color: TRUCK_COLORS[i % TRUCK_COLORS.length] }}>Truck {m.truckId}</span>
                        <span className="text-xs text-ink-faint">{Math.round(m.remainingCapacityLbs / 1000)}k open</span>
                      </div>
                      <ul className="mt-2 space-y-1.5 text-xs text-ink-muted">
                        {m.stops.map((s, j) => (
                          <li key={j}>
                            <div className={s.inGroup ? "font-medium text-ink" : ""}>
                              {s.customer} · {Math.round(s.weightLbs).toLocaleString()} lb · {s.window}
                              {s.inGroup ? " ◄" : ""}
                            </div>
                            {s.product && (
                              <div className="text-ink-faint">
                                {s.product} · {s.quantity?.toLocaleString()} {s.unit}
                                {s.boardFeet ? ` · ${s.boardFeet.toLocaleString()} bf` : ""}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm">
                  Combined group load <span className="font-semibold text-ink">{detail.combinedGroupWeightLbs.toLocaleString()} lb</span> vs{" "}
                  {detail.maxLoadLbs.toLocaleString()} lb legal —{" "}
                  <span className={`badge ${detail.legal ? "badge-green" : "badge-crimson"}`}>
                    {detail.legal ? "fits one truck legally" : "requires split (legal)"}
                  </span>
                </p>
              </Section>

              {detail.billOfLading.length > 0 && (
                <Section title="Consolidated bill of lading">
                  <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-black/[0.02] text-left uppercase tracking-wide text-ink-faint">
                          <th className="px-2 py-2 font-medium">Order</th>
                          <th className="px-2 py-2 font-medium">Product</th>
                          <th className="px-2 py-2 text-right font-medium">Qty</th>
                          <th className="px-2 py-2 text-right font-medium">Board ft</th>
                          <th className="px-2 py-2 text-right font-medium">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.billOfLading.map((li) => (
                          <tr key={li.order_number} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-2 font-mono text-ink-muted">{li.order_number}</td>
                            <td className="px-2 py-2 text-ink">
                              {li.product ?? "—"}
                              <span className="block text-ink-faint">{li.customer}</span>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                              {li.quantity?.toLocaleString() ?? "—"} {li.unit ?? ""}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                              {li.board_feet ? li.board_feet.toLocaleString() : "—"}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                              {li.weight_lbs?.toLocaleString() ?? "—"} lb
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-black/[0.02] font-semibold text-ink">
                          <td className="px-2 py-2" colSpan={4}>
                            Consolidated load · {detail.billOfLading.length} orders
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {detail.combinedGroupWeightLbs.toLocaleString()} lb
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              <Section title="Before → after routes">
                <div className="space-y-3">
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

              <Section title="The numbers">
                <div className="grid grid-cols-2 gap-3">
                  <Num label="Wasted miles" value={num(detail.numbers.wastedMiles)} hint={detail.numbers.milesContext} />
                  <Num label="Wasted fleet-hrs" value={num(detail.numbers.wastedHours)} hint="at 45 mph + 45 min/stop" />
                  <Num label="Recoverable" value={money(detail.numbers.recoverable)} accent hint="own-fleet cost of the redundant trips" />
                  <Num label="At 3PL rate" value={money(detail.numbers.cost3pl)} hint="northeast flatbed benchmark" />
                  <Num label="Load factor before" value={`${detail.numbers.loadFactorBefore}%`} hint={`${detail.distinctTrucks} trucks`} />
                  <Num label="Load factor after" value={`${detail.numbers.loadFactorAfter}%`} hint={`${detail.minTrucksNeeded} truck`} />
                </div>
              </Section>

              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
                <button onClick={sendToDmsi} disabled={sending} className="btn btn-primary">
                  {sending ? "Sending…" : "Send to DMSi dispatch"}
                </button>
                {sendResult && <span className="text-sm text-ink-muted">{sendResult}</span>}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function verdict(d: Detail): string {
  const s = d.distinctTrucks - d.minTrucksNeeded;
  if (d.legal) {
    return `✓ One truck legally carries all ${d.combinedGroupWeightLbs.toLocaleString()} lb — consolidating ${d.distinctTrucks} → ${d.minTrucksNeeded} truck recovers ${money(d.numbers.recoverable)}.`;
  }
  return `✓ ${d.minTrucksNeeded} trucks legally carry the ${d.combinedGroupWeightLbs.toLocaleString()} lb — ${s} of the ${d.distinctTrucks} dispatched were redundant, recovering ${money(d.numbers.recoverable)}.`;
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
