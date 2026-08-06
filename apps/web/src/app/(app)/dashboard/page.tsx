import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, num, shortDate } from "@/lib/format";
import type { AnalysisRun, ConsolidationFinding, RunTotals } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { run?: string };
}) {
  const supabase = createClient();

  let run: AnalysisRun | null = null;
  if (searchParams.run) {
    const { data } = await supabase
      .from("analysis_runs")
      .select("*")
      .eq("id", searchParams.run)
      .maybeSingle();
    run = data as AnalysisRun | null;
  } else {
    const { data } = await supabase
      .from("analysis_runs")
      .select("*")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    run = data as AnalysisRun | null;
  }

  if (!run) return <EmptyState />;

  const { data: findingsData } = await supabase
    .from("consolidation_findings")
    .select("*")
    .eq("run_id", run.id)
    .order("est_cost_usd", { ascending: false });
  const findings = (findingsData ?? []) as ConsolidationFinding[];

  const totals = run.params?.totals;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            Consolidation findings
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Run from {shortDate(run.created_at)} ·{" "}
            <span className="capitalize">{run.status}</span>
            {totals ? ` · ${totals.records_analyzed} deliveries analyzed` : ""}
          </p>
        </div>
        <Link href="/analyze" className="btn btn-ghost">
          New analysis
        </Link>
      </div>

      {run.status !== "completed" ? (
        <div className="rounded-xl border border-geo/30 bg-geo/10 px-4 py-3 text-sm text-geo">
          This run is <span className="font-medium">{run.status}</span>.
          {run.params?.error ? ` (${run.params.error})` : ""}
        </div>
      ) : (
        <>
          <HeroAndBeforeAfter totals={totals} />
          <FindingsTable findings={findings} />
        </>
      )}
    </div>
  );
}

function HeroAndBeforeAfter({ totals }: { totals?: RunTotals }) {
  if (!totals) return null;
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {/* Hero: the number */}
      <div className="panel relative overflow-hidden border-brand-200 bg-gradient-to-b from-brand-50 to-white p-6 lg:col-span-1">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-brand-600/15 blur-3xl"
        />
        <div className="text-sm font-medium text-ink-muted">
          Estimated recoverable cost
        </div>
        <div className="mt-2 text-4xl font-semibold tracking-tight text-good">
          {money(totals.cost_internal)}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Own-fleet cost of{" "}
          <span className="font-medium text-ink">{totals.redundant_trucks}</span>{" "}
          redundant truck-trips across{" "}
          <span className="font-medium text-ink">{totals.candidate_groups}</span>{" "}
          consolidation candidates.
        </p>
        <div className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-ink-faint">
          At the 3PL benchmark rate, the same miles run{" "}
          {money(totals.cost_3pl_benchmark)}.
        </div>
      </div>

      {/* Before / After */}
      <div className="panel p-6 lg:col-span-2">
        <div className="mb-4 text-sm font-medium text-ink-muted">
          Before → After (consolidated)
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Delta
            label="Truck visits"
            before={totals.truck_visits_before}
            after={totals.truck_visits_after}
          />
          <Delta label="Redundant trips" before={totals.redundant_trucks} after={0} />
          <Delta label="Wasted miles" before={num(totals.wasted_miles)} after={0} />
          <Delta
            label="Wasted fleet-hrs"
            before={num(totals.wasted_fleet_hours)}
            after={0}
          />
        </div>
        {totals.records_skipped_no_coords > 0 && (
          <p className="mt-4 text-xs text-ink-faint">
            {totals.records_skipped_no_coords} record(s) skipped for missing
            coordinates, date, or truck id.
          </p>
        )}
      </div>
    </section>
  );
}

function Delta({
  label,
  before,
  after,
}: {
  label: string;
  before: number | string;
  after: number | string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-2 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-ink">{before}</span>
        <span className="text-ink-faint">→</span>
        <span className="text-xl font-semibold text-good">{after}</span>
      </div>
    </div>
  );
}

function FindingsTable({ findings }: { findings: ConsolidationFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="panel p-8 text-center text-sm text-ink-muted">
        No consolidation candidates in this run — every delivery rode a single
        truck.
      </div>
    );
  }
  return (
    <section className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-black/[0.02] text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-3 font-medium">Customer / cluster</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Trucks</th>
              <th className="px-4 py-3 text-right font-medium">Wasted mi</th>
              <th className="px-4 py-3 text-right font-medium">Fleet-hrs</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr
                key={f.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-medium text-ink">
                  {f.customer_name}
                </td>
                <td className="px-4 py-3 text-ink-muted">{shortDate(f.date)}</td>
                <td className="px-4 py-3">
                  <TypeBadge type={f.consolidated_plan_json?.type} />
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  {f.consolidated_plan_json?.truck_ids?.join(" · ") ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                  {num(f.wasted_miles)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                  {num(f.wasted_hours)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                  {money(f.est_cost_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TypeBadge({ type }: { type?: string }) {
  const isGeo = type === "geo_cluster";
  return (
    <span className={`badge ${isGeo ? "badge-orange" : "badge-blue"}`}>
      <span
        className="mr-1.5 inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: isGeo ? "#f58231" : "#4363d8" }}
      />
      {isGeo ? "geo cluster" : "same customer"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="panel mx-auto max-w-lg p-10 text-center">
      <h1 className="text-lg font-semibold text-ink">No analysis yet</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Upload a delivery CSV, then run an analysis to see where trucks doubled
        up and what it cost.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/uploads" className="btn btn-primary">
          Upload a CSV
        </Link>
        <Link href="/analyze" className="btn btn-ghost">
          Analyze
        </Link>
      </div>
    </div>
  );
}
