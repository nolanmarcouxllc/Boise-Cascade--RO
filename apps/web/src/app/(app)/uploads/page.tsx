import { createClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/format";
import type { Upload } from "@/lib/types";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadsPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("uploads")
    .select("*")
    .order("created_at", { ascending: false });
  const uploads = (data ?? []) as Upload[];

  // Count records per upload for a quick sanity signal.
  const { data: recCounts } = await supabase
    .from("delivery_records")
    .select("upload_id");
  const counts = new Map<string, number>();
  for (const r of recCounts ?? []) {
    const k = (r as { upload_id: string | null }).upload_id;
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Upload your delivery data</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Upload a spreadsheet of past deliveries (a CSV file — most systems can
          export one). It&apos;s stored privately, and each row becomes a
          delivery this tool can check for wasted trips.
        </p>
      </div>

      <UploadForm />

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">
          Files you&apos;ve uploaded
        </h2>
        {uploads.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-ink-muted">
            No files uploaded yet.
          </p>
        ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-black/[0.02] text-left text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3 font-medium">File name</th>
                    <th className="px-4 py-3 font-medium">When uploaded</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Deliveries in it</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                        {u.storage_path.split("/").pop()}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {shortDate(u.created_at)}
                      </td>
                      <td className="px-4 py-3 capitalize text-ink-muted">
                        {u.status}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                        {counts.get(u.id) ?? 0}
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
