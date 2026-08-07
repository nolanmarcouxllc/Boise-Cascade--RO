"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/format";

type Stop = {
  sequence: number; recordId: string; orderNumber: string | null; customer: string;
  address: string | null; weightLbs: number; wave: string; lat: number; lng: number;
};
type Route = { truckId: string; date: string; totalWeightLbs: number; miles: number; stops: Stop[] };
type PlanData = {
  id: string;
  plan: { summary?: { loads: number; recoverable: number }; routes: Route[]; pushMode?: string };
  maxLoadLbs: number;
};

/**
 * Manual override editor. The automated plan is the default — dispatchers stay
 * in control: drag stops between trucks (or use the move menu / arrows),
 * remove stops, resequence, then save and re-push to DMSi. Every override is
 * audited with who made it and what changed.
 */
export function PlanEditor({ planId, onClose }: { planId: string; onClose: () => void }) {
  const [data, setData] = useState<PlanData | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [removed, setRemoved] = useState<Stop[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/plans/${planId}`);
      if (!res.ok) return;
      const body = (await res.json()) as PlanData;
      setData(body);
      setRoutes(JSON.parse(JSON.stringify(body.plan.routes ?? [])));
    })();
  }, [planId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!data) {
    return (
      <Overlay onClose={onClose}>
        <div className="py-10 text-center text-sm text-ink-faint">Loading plan…</div>
      </Overlay>
    );
  }

  const cap = data.maxLoadLbs;
  const weightOf = (r: Route) => r.stops.reduce((a, s) => a + s.weightLbs, 0);
  const anyOverweight = routes.some((r) => weightOf(r) > cap);

  function moveStop(recordId: string, toTruck: string, toIndex?: number) {
    setRoutes((prev) => {
      const next = prev.map((r) => ({ ...r, stops: [...r.stops] }));
      let stop: Stop | null = null;
      for (const r of next) {
        const i = r.stops.findIndex((s) => s.recordId === recordId);
        if (i >= 0) stop = r.stops.splice(i, 1)[0];
      }
      if (!stop) {
        const i = removed.findIndex((s) => s.recordId === recordId);
        if (i >= 0) {
          stop = removed[i];
          setRemoved((rm) => rm.filter((s) => s.recordId !== recordId));
        }
      }
      if (!stop) return prev;
      const target = next.find((r) => r.truckId === toTruck);
      if (!target) return prev;
      if (toIndex == null || toIndex > target.stops.length) target.stops.push(stop);
      else target.stops.splice(toIndex, 0, stop);
      return next;
    });
  }

  function nudge(truckId: string, idx: number, dir: -1 | 1) {
    setRoutes((prev) =>
      prev.map((r) => {
        if (r.truckId !== truckId) return r;
        const stops = [...r.stops];
        const j = idx + dir;
        if (j < 0 || j >= stops.length) return r;
        [stops[idx], stops[j]] = [stops[j], stops[idx]];
        return { ...r, stops };
      }),
    );
  }

  function removeStop(recordId: string) {
    setRoutes((prev) => {
      const next = prev.map((r) => ({ ...r, stops: [...r.stops] }));
      for (const r of next) {
        const i = r.stops.findIndex((s) => s.recordId === recordId);
        if (i >= 0) {
          setRemoved((rm) => [...rm, r.stops[i]]);
          r.stops.splice(i, 1);
        }
      }
      return next;
    });
  }

  async function save(thenPush: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: routes.map((r) => ({ truckId: r.truckId, date: r.date, stops: r.stops })) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Save failed");
      let out = `Saved (${body.changes}).`;
      if (thenPush) {
        const ok = window.confirm(
          "Re-push this plan to DMSi dispatch?\n\nSimulation mode logs the exact payload without touching production.",
        );
        if (ok) {
          const pres = await fetch(`/api/plans/${planId}/push`, { method: "POST" });
          const pbody = await pres.json();
          if (!pres.ok) throw new Error(pbody?.error ?? "Push failed");
          out += ` ${pbody.message}`;
        }
      }
      setMsg(out);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Dispatch plan — manual override</h3>
          <p className="text-sm text-ink-muted">
            Drag stops between trucks (or use the controls), then save and
            re-push. Every change is audited.
          </p>
        </div>
        <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">✕</button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {routes.map((r) => {
          const w = weightOf(r);
          const over = w > cap;
          return (
            <div
              key={r.truckId}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) moveStop(dragging, r.truckId);
                setDragging(null);
              }}
              className={`rounded-xl border p-3 ${over ? "border-alert bg-alert/5" : "border-[var(--border)] bg-surface-2"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Truck {r.truckId}</span>
                <span className={`text-xs tabular-nums ${over ? "font-semibold text-alert" : "text-ink-muted"}`}>
                  {w.toLocaleString()} / {cap.toLocaleString()} lb{over ? " — OVER LEGAL LIMIT" : ""}
                </span>
              </div>
              <ol className="mt-2 space-y-1.5">
                {r.stops.map((s, i) => (
                  <li
                    key={s.recordId}
                    draggable
                    onDragStart={() => setDragging(s.recordId)}
                    onDragEnd={() => setDragging(null)}
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-xs active:cursor-grabbing"
                  >
                    <span className="text-ink-faint">{i + 1}.</span>
                    <span className="flex-1 truncate">
                      <span className="font-medium text-ink">{s.customer}</span>{" "}
                      <span className="text-ink-faint">
                        {s.orderNumber} · {s.weightLbs.toLocaleString()} lb · {s.wave}
                      </span>
                    </span>
                    <button onClick={() => nudge(r.truckId, i, -1)} className="text-ink-faint hover:text-ink" title="Earlier">↑</button>
                    <button onClick={() => nudge(r.truckId, i, 1)} className="text-ink-faint hover:text-ink" title="Later">↓</button>
                    <select
                      value=""
                      onChange={(e) => e.target.value && moveStop(s.recordId, e.target.value)}
                      className="!w-auto !border-0 !bg-transparent !p-0 text-[11px] text-ink-faint"
                      title="Move to truck"
                    >
                      <option value="">→</option>
                      {routes.filter((x) => x.truckId !== r.truckId).map((x) => (
                        <option key={x.truckId} value={x.truckId}>{x.truckId}</option>
                      ))}
                    </select>
                    <button onClick={() => removeStop(s.recordId)} className="text-alert/70 hover:text-alert" title="Remove from plan">✕</button>
                  </li>
                ))}
                {r.stops.length === 0 && <li className="text-xs text-ink-faint">Empty — drop a stop here or it will be dropped from the push.</li>}
              </ol>
            </div>
          );
        })}
      </div>

      {removed.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-[var(--border-strong)] p-3">
          <div className="text-xs font-medium text-ink-muted">
            Removed from plan ({removed.length}) — drag back onto a truck to restore; otherwise they stay out of the DMSi push.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {removed.map((s) => (
              <span
                key={s.recordId}
                draggable
                onDragStart={() => setDragging(s.recordId)}
                className="cursor-grab rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs text-ink-muted"
              >
                {s.customer} · {s.weightLbs.toLocaleString()} lb
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        <button onClick={() => save(false)} disabled={busy || anyOverweight} className="btn btn-ghost">
          {busy ? "Working…" : "Save override"}
        </button>
        <button onClick={() => save(true)} disabled={busy || anyOverweight} className="btn btn-primary">
          {busy ? "Working…" : "Save & re-push to DMSi"}
        </button>
        {anyOverweight && <span className="text-sm font-medium text-alert">A truck is over the legal limit — rebalance before pushing.</span>}
        {msg && <span className="text-sm text-ink-muted">{msg}</span>}
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[1100] bg-black/30" aria-hidden />
      <div className="fixed inset-x-4 top-[6vh] z-[1101] mx-auto max-h-[86vh] max-w-4xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-6 shadow-2xl">
        {children}
      </div>
    </>
  );
}
