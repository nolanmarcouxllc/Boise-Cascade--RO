import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { shortDate, money } from "@/lib/format";
import type { AnalysisRun, Upload } from "@/lib/types";
import { AnalyzePanel } from "./analyze-panel";

export const dynamic = "force-dynamic";

export default async function AnalyzePage() {
  const supabase = createClient();

  const { data: uploadsData } = await supabase
    .from("uploads")
    .select("*")
    .order("created_at", { ascending: false });
  const uploads = (uploadsData ?? []) as Upload[];

  const { data: recCounts } = await supabase
    .from("delivery_records")
    .select("upload_id");
  const counts = new Map<string, number>();
  for (const r of recCounts ?? []) {
    const k = (r as { upload_id: string | null }).upload_id;
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const options = uploads.map((u) => ({
    id: u.id,
    label: u.storage_path.split("/").pop() ?? u.id,
    date: shortDate(u.created_at),
    records: counts.get(u.id) ?? 0,
  }));

  const { data: runsData } = await supabase
    .from("analysis_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
  const runs = (runsData ?? []) as AnalysisRun[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Analyze</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Run the consolidation engine over an uploaded dataset.
        </p>
      </div>

      <AnalyzePanel options={options} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-ink-muted">
            No runs yet.
          </p>
        ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-black/[0.02] text-left text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3 font-medium">Run</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Candidates</th>
                    <th className="px-4 py-3 text-right font-medium">Recoverable</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-4 py-3 text-ink-muted">
                        {shortDate(r.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                        {r.params?.totals?.candidate_groups ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                        {r.params?.totals
                          ? money(r.params.totals.cost_internal)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "completed" && (
                          <Link
                            href={`/dashboard?run=${r.id}`}
                            className="text-sm font-medium text-brand-700 hover:text-brand-600"
                          >
                            View →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "badge-green",
    running: "badge-amber",
    pending: "badge-slate",
    failed: "badge-crimson",
  };
  return (
    <span className={`badge capitalize ${styles[status] ?? "badge-slate"}`}>
      {status}
    </span>
  );
}
