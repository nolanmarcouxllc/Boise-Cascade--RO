import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, num, shortDate } from "@/lib/format";
import { DashboardClient } from "@/components/dashboard-client";
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

  // Default the fleet map to the worst day (most findings) — the headline.
  const worstDay = pickWorstDay(findings);

  // Latest automated dispatch plan (last 24h) for the notification banner.
  const { data: planRow } = await supabase
    .from("optimized_plans")
    .select("id, plan, trucks_before, trucks_after, created_at")
    .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const banner = planRow
    ? {
        planId: planRow.id as string,
        loads: (planRow.plan?.summary?.loads as number) ?? 0,
        trucks: (planRow.trucks_after as number) ?? 0,
        trucksBefore: (planRow.trucks_before as number) ?? 0,
        recoverable: (planRow.plan?.summary?.recoverable as number) ?? 0,
        pushedAt: (planRow.plan?.pushedAt as string) ?? null,
        pushMode: (planRow.plan?.pushMode as string) ?? null,
      }
    : null;

  const totals = run.params?.totals;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            Wasted truck trips we found in your deliveries
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            We checked {totals ? totals.records_analyzed.toLocaleString() : "your"} deliveries
            on {shortDate(run.created_at)}, looking for orders that went out on
            separate trucks when one truck could have carried them.
          </p>
        </div>
        <Link href="/analyze" className="btn btn-ghost">
          Check a new set of deliveries
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
          {findings.length > 0 ? (
            <DashboardClient findings={findings} initialDate={worstDay} banner={banner} />
          ) : (
            <FindingsTable findings={findings} />
          )}
        </>
      )}
    </div>
  );
}

// The day with the most findings — the most compelling default for the map.
function pickWorstDay(findings: ConsolidationFinding[]): string | undefined {
  const counts = new Map<string, number>();
  for (const f of findings) {
    if (!f.date) continue;
    counts.set(f.date, (counts.get(f.date) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = -1;
  for (const [d, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = d;
    }
  }
  return best;
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
          Money wasted on unnecessary trips
        </div>
        <div className="mt-2 text-4xl font-semibold tracking-tight text-good">
          {money(totals.cost_internal)}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          wasted — money spent sending extra trucks that weren&apos;t needed.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Your trucks made{" "}
          <span className="font-medium text-ink">{totals.redundant_trucks}</span>{" "}
          trips that a truck already headed there could have covered, across{" "}
          <span className="font-medium text-ink">{totals.candidate_groups}</span>{" "}
          separate cases.
        </p>
        <div className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-ink-faint">
          For comparison: paying an outside trucking company to drive those same
          extra miles would cost {money(totals.cost_3pl_benchmark)}.
        </div>
      </div>

      {/* Before / After */}
      <div className="panel p-6 lg:col-span-2">
        <div className="text-sm font-medium text-ink-muted">
          What happened → what combining the trips would look like
        </div>
        <p className="mb-4 mt-0.5 text-xs text-ink-faint">
          Left number: how things actually ran. Right number (green): how they
          would run if overlapping deliveries shared a truck.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Delta
            label="Truck trips to these places"
            hint="separate trucks sent to the flagged locations"
            before={totals.truck_visits_before}
            after={totals.truck_visits_after}
          />
          <Delta
            label="Unnecessary trips"
            hint="trips another truck could have covered"
            before={totals.redundant_trucks}
            after={0}
          />
          <Delta
            label="Extra miles driven"
            hint="road miles those unnecessary trips added"
            before={num(totals.wasted_miles)}
            after={0}
          />
          <Delta
            label="Extra driver hours"
            hint="paid time spent on those trips"
            before={num(totals.wasted_fleet_hours)}
            after={0}
          />
        </div>
        {totals.records_skipped_no_coords > 0 && (
          <p className="mt-4 text-xs text-ink-faint">
            {totals.records_skipped_no_coords} delivery record(s) couldn&apos;t be
            checked because they were missing an address location, date, or truck.
          </p>
        )}
      </div>
    </section>
  );
}

function Delta({
  label,
  hint,
  before,
  after,
}: {
  label: string;
  hint?: string;
  before: number | string;
  after: number | string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-2 p-4">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-ink">{before}</span>
        <span className="text-ink-faint">→</span>
        <span className="text-xl font-semibold text-good">{after}</span>
      </div>
      {hint && <div className="mt-1 text-[11px] leading-tight text-ink-faint">{hint}</div>}
    </div>
  );
}

function FindingsTable({ findings }: { findings: ConsolidationFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="panel p-8 text-center text-sm text-ink-muted">
        Good news — no wasted trips found. Every delivery in this data went out
        on the right truck.
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
    <span className={`badge ${isGeo ? "badge-orange" : "badge-green"}`}>
      <span
        className="mr-1.5 inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: isGeo ? "#f58231" : "#0a8a43" }}
      />
      {isGeo ? "geo cluster" : "same customer"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="panel mx-auto max-w-lg p-10 text-center">
      <h1 className="text-lg font-semibold text-ink">Nothing to show yet</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Upload a spreadsheet of your deliveries, then run a check to see where
        trucks doubled up and what it cost you.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/uploads" className="btn btn-primary">
          Upload your delivery data
        </Link>
        <Link href="/analyze" className="btn btn-ghost">
          Find duplicate deliveries
        </Link>
      </div>
    </div>
  );
}
