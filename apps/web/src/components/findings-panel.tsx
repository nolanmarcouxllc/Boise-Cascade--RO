"use client";

import { useMemo, useState } from "react";
import { money, num, shortDate } from "@/lib/format";
import type { ConsolidationFinding } from "@/lib/types";

type SortKey = "cost" | "miles" | "date" | "customer";

export function FindingsPanel({
  findings,
  selectedId,
  onSelect,
}: {
  findings: ConsolidationFinding[];
  selectedId: string | null;
  onSelect: (f: ConsolidationFinding | null) => void;
}) {
  const [sort, setSort] = useState<SortKey>("cost");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...findings];
    const s = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sort === "cost") return s * ((a.est_cost_usd ?? 0) - (b.est_cost_usd ?? 0));
      if (sort === "miles") return s * ((a.wasted_miles ?? 0) - (b.wasted_miles ?? 0));
      if (sort === "date") return s * (a.date ?? "").localeCompare(b.date ?? "");
      return s * (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
    });
    return arr;
  }, [findings, sort, dir]);

  const shown = showAll ? sorted : sorted.slice(0, 10);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "customer" || k === "date" ? "asc" : "desc");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Consolidation findings</h2>
        <p className="text-xs text-ink-muted">Click any row for the full breakdown →</p>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-black/[0.02] text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">#</th>
                <SortableTh label="Customer / cluster" active={sort === "customer"} dir={dir} onClick={() => toggleSort("customer")} />
                <SortableTh label="Date" active={sort === "date"} dir={dir} onClick={() => toggleSort("date")} />
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Trucks → fix</th>
                <SortableTh label="Wasted mi" active={sort === "miles"} dir={dir} onClick={() => toggleSort("miles")} right />
                <SortableTh label="Recoverable" active={sort === "cost"} dir={dir} onClick={() => toggleSort("cost")} right />
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f, i) => {
                const isSel = f.id === selectedId;
                return (
                  <tr
                    key={f.id}
                    onClick={() => onSelect(isSel ? null : f)}
                    className={`cursor-pointer border-b border-slate-100 last:border-0 ${isSel ? "bg-brand-600/10" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-4 py-3 tabular-nums text-ink-faint">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-ink">{f.customer_name}</td>
                    <td className="px-4 py-3 text-ink-muted">{shortDate(f.date)}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${f.consolidated_plan_json?.type === "geo_cluster" ? "badge-orange" : "badge-green"}`}>
                        {f.consolidated_plan_json?.type === "geo_cluster" ? "geo" : "same cust"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                      {f.consolidated_plan_json?.distinct_trucks ?? "—"}
                      <span className="text-ink-faint"> → </span>
                      <span className="text-good">{f.consolidated_plan_json?.min_trucks_needed ?? 1}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{num(f.wasted_miles)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{money(f.est_cost_usd)}</td>
                    <td className="px-2 py-3 text-right text-ink-faint">{isSel ? "▾" : "▸"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {findings.length > 10 && (
          <div className="border-t border-[var(--border)] p-3 text-center">
            <button onClick={() => setShowAll((v) => !v)} className="text-sm font-medium text-brand-700 hover:text-brand-600">
              {showAll ? "Show top 10" : `Show all ${findings.length} findings`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  right,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  right?: boolean;
}) {
  return (
    <th className={`px-4 py-3 font-medium ${right ? "text-right" : ""}`}>
      <button onClick={onClick} className={`inline-flex items-center gap-1 ${active ? "text-ink" : "hover:text-ink-muted"}`}>
        {label}
        {active && <span>{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}
