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
      "Send this combined delivery plan to your dispatch system (DMSi)?\n\n" +
        "Right now this runs in practice mode: nothing touches your live dispatch " +
        "system — the exact plan is saved so it can be reviewed first.",
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
      setSendResult(
        body.mode === "live"
          ? "Sent to your dispatch system."
          : "Practice run complete — the plan was saved for review; nothing was sent to your live dispatch system.",
      );
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
                  {shortDate(detail.date)} ·{" "}
                  {detail.type === "geo_cluster"
                    ? "two trucks sent to the same area"
                    : "multiple trucks sent to the same customer"}{" "}
                  · {detail.distinctTrucks} trucks were used
                </p>
                {/* one-line verdict */}
                <div className="mt-2 rounded-lg border border-good/30 bg-good/10 p-3 text-sm font-medium text-good">
                  {verdict(detail)}
                </div>
              </div>

              <Section title="Why this happened">
                <p className="text-sm leading-relaxed text-ink-muted">{whyText(detail)}</p>
              </Section>

              <Section title="What was on each truck that day">
                <div className="grid gap-3 sm:grid-cols-2">
                  {detail.manifest.map((m, i) => (
                    <div key={m.truckId} className="rounded-lg border border-[var(--border)] bg-surface-2 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold" style={{ color: TRUCK_COLORS[i % TRUCK_COLORS.length] }}>Truck {m.truckId}</span>
                        <span className="text-xs text-ink-faint">
                          {Math.round(m.remainingCapacityLbs / 1000)}k lb of room left
                        </span>
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
                  All of these orders together weigh{" "}
                  <span className="font-semibold text-ink">{detail.combinedGroupWeightLbs.toLocaleString()} lb</span>.
                  A truck can legally carry {detail.maxLoadLbs.toLocaleString()} lb —{" "}
                  <span className={`badge ${detail.legal ? "badge-green" : "badge-crimson"}`}>
                    {detail.legal
                      ? "so one truck could have carried it all, legally"
                      : "so splitting across trucks was the right call"}
                  </span>
                </p>
              </Section>

              {detail.billOfLading.length > 0 && (
                <Section
                  title="Bill of Lading — the full list of what was on these trucks"
                >
                  <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-black/[0.02] text-left uppercase tracking-wide text-ink-faint">
                          <th className="px-2 py-2 font-medium">Order number</th>
                          <th className="px-2 py-2 font-medium">What was shipped</th>
                          <th className="px-2 py-2 text-right font-medium">How much</th>
                          <th className="px-2 py-2 text-right font-medium">Board feet</th>
                          <th className="px-2 py-2 text-right font-medium">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.billOfLading.map((li) => (
                          <tr key={li.order_number} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-2 font-mono text-ink-muted">{li.order_number}</td>
                            <td className="px-2 py-2 text-ink">
                              {li.product ?? "—"}
                              {productPlain(li.product) && (
                                <span className="text-ink-faint"> ({productPlain(li.product)})</span>
                              )}
                              <span className="block text-ink-faint">for {li.customer}</span>
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
                            Everything combined · {detail.billOfLading.length} orders on one truck
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

              <Section title="The routes on a map — what happened vs. the fix">
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-alert">
                      What actually happened — each truck&apos;s full day, one color per truck
                    </div>
                    <DrawerMap
                      depot={detail.depot}
                      routes={detail.before.map((b, i) => ({ geometry: b.geometry, color: TRUCK_COLORS[i % TRUCK_COLORS.length] }))}
                      stops={detail.before.flatMap((b, i) => b.stops.map((s) => ({ lat: s.lat, lng: s.lng, color: TRUCK_COLORS[i % TRUCK_COLORS.length], label: s.customer ?? "" })))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-good">
                      What should have happened — one truck covering all the stops
                    </div>
                    <DrawerMap
                      depot={detail.depot}
                      routes={[{ geometry: detail.after.geometry, color: GOOD }]}
                      stops={detail.after.stops.map((s) => ({ lat: s.lat, lng: s.lng, color: GOOD, label: s.customer ?? "" }))}
                    />
                  </div>
                </div>
              </Section>

              <Section title="What this cost you">
                <div className="grid grid-cols-2 gap-3">
                  <Num
                    label="Extra miles driven"
                    value={num(detail.numbers.wastedMiles)}
                    hint={detail.numbers.milesContext}
                  />
                  <Num
                    label="Extra driver hours paid"
                    value={num(detail.numbers.wastedHours)}
                    hint="time behind the wheel plus loading and unloading"
                  />
                  <Num
                    label="Money wasted"
                    value={money(detail.numbers.recoverable)}
                    accent
                    hint="what the unnecessary trips cost in fuel, wear, and driver pay"
                  />
                  <Num
                    label="Outside carrier comparison"
                    value={money(detail.numbers.cost3pl)}
                    hint="what a hired trucking company would charge for those same miles"
                  />
                  <Num
                    label="How full the trucks were"
                    value={`${detail.numbers.loadFactorBefore}%`}
                    hint={`spread across ${detail.distinctTrucks} trucks`}
                  />
                  <Num
                    label="How full after combining"
                    value={`${detail.numbers.loadFactorAfter}%`}
                    hint={`on ${detail.minTrucksNeeded} truck${detail.minTrucksNeeded > 1 ? "s" : ""}`}
                  />
                </div>
              </Section>

              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
                <button onClick={sendToDmsi} disabled={sending} className="btn btn-primary">
                  {sending ? "Sending…" : "Send this combined plan to your dispatch system (DMSi)"}
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
  const extraTrips = d.distinctTrucks - d.minTrucksNeeded;
  const tripWord = extraTrips === 1 ? "trip" : "trips";
  if (d.minTrucksNeeded === 1) {
    return `✓ One truck could have legally carried all of these orders — combining them would have saved ${money(d.numbers.recoverable)} and eliminated ${extraTrips} unnecessary ${tripWord}.`;
  }
  return `✓ ${d.minTrucksNeeded} trucks could have legally carried all of these orders — combining them would have saved ${money(d.numbers.recoverable)} and eliminated ${extraTrips} unnecessary ${tripWord}.`;
}

function whyText(d: Detail): string {
  const parts = d.waves.map((w) => `${w.count} order(s) at ${w.window}`).join(", then ");
  if (d.type === "geo_cluster") {
    return `Your order system released ${parts} for customers in the same area. The routes for the ${d.waves[0]?.window ?? "first"} wave were already built before the later orders came through — so a second truck drove to a neighborhood the first truck could have covered with the room it had left.`;
  }
  return `Your order system released ${parts} for ${d.customer}. The routes for the ${d.waves[0]?.window ?? "first"} wave were already built before the later orders came through — so ${d.distinctTrucks} separate trucks were sent to the same customer when ${d.minTrucksNeeded} could have legally carried the combined ${d.combinedGroupWeightLbs.toLocaleString()} lb.`;
}

// Plain-English expansions for building-products jargon, shown the first time
// a product appears.
const PRODUCT_PLAIN: [RegExp, string][] = [
  [/^LVL/i, "laminated veneer lumber — engineered beams"],
  [/^OSB/i, "oriented strand board — wall and roof panels"],
  [/plywood/i, "construction-grade plywood sheets"],
  [/I-Joist/i, "engineered floor joists"],
  [/Dimensional Lumber/i, "standard framing lumber"],
  [/Hardie/i, "fiber cement siding"],
  [/Vinyl Siding/i, "vinyl house siding"],
  [/Decking/i, "composite deck boards"],
  [/Millwork|Trim/i, "interior trim and molding"],
];

function productPlain(name: string | null): string | null {
  if (!name) return null;
  for (const [re, plain] of PRODUCT_PLAIN) {
    if (re.test(name)) return plain;
  }
  return null;
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
