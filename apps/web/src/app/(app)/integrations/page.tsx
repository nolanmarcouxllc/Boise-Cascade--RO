import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getIntegrationStatus } from "@/lib/integrations/status";
import { shortDate } from "@/lib/format";
import { DmsiPullButton } from "./pull-button";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: string;
  source_system: string;
  event_type: string;
  status: string;
  record_count: number;
  message: string | null;
  created_at: string;
};

export default async function IntegrationsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.org) redirect("/onboarding");

  const statuses = await getIntegrationStatus(ctx.org.id);
  const supabase = createClient();
  const { data: auditData } = await supabase
    .from("integration_audit_log")
    .select("id, source_system, event_type, status, record_count, message, created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  const audit = (auditData ?? []) as AuditRow[];

  const ediPath = "/api/integrations/edi";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Integrations</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Live connection status for the systems this tool sits between. Green
          means credentialed and synced; amber means wired and waiting for
          credentials.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {statuses.map((s) => (
          <div key={s.system} className="panel p-5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{s.label}</span>
              <StatusDot connected={s.connected} configured={s.configured} />
            </div>
            <p className="mt-2 text-sm text-ink-muted">{s.detail}</p>
            <dl className="mt-4 space-y-1 text-xs text-ink-faint">
              <div className="flex justify-between">
                <dt>Last sync</dt>
                <dd className="text-ink-muted">{s.lastSyncAt ? shortDate(s.lastSyncAt) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Records ingested</dt>
                <dd className="tabular-nums text-ink-muted">{s.lastRecordCount}</dd>
              </div>
              {s.system === "dmsi" && (
                <div className="flex justify-between">
                  <dt>Mode</dt>
                  <dd className={s.liveMode ? "text-alert" : "text-ink-muted"}>
                    {s.liveMode ? "LIVE" : "Simulation"}
                  </dd>
                </div>
              )}
            </dl>
            {s.system === "dmsi" && <DmsiPullButton />}
          </div>
        ))}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-medium text-ink">EDI webhook</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Point the Kleinschmidt gateway here. Every request is HMAC-SHA256
          verified and IP-allowlisted; unsigned or off-list requests are rejected
          and logged.
        </p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[160px_1fr]">
          <dt className="text-ink-faint">Endpoint</dt>
          <dd className="font-mono text-ink">POST {ediPath}</dd>
          <dt className="text-ink-faint">Accepts</dt>
          <dd className="text-ink-muted">EDI 204, EDI 211, or CSV fallback</dd>
          <dt className="text-ink-faint">Required headers</dt>
          <dd className="font-mono text-ink">X-EDI-Signature, X-Org-Id</dd>
          <dt className="text-ink-faint">Your Org-Id</dt>
          <dd className="font-mono text-ink">{ctx.org.id}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Recent integration events</h2>
        {audit.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-ink-muted">
            No integration events yet.
          </p>
        ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-black/[0.02] text-left text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">System</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Records</th>
                    <th className="px-4 py-3 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-ink-muted">{shortDate(a.created_at)}</td>
                      <td className="px-4 py-3 uppercase text-ink-muted">{a.source_system}</td>
                      <td className="px-4 py-3 text-ink-muted">{a.event_type}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${a.status === "success" ? "badge-green" : a.status === "rejected" ? "badge-crimson" : "badge-amber"}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{a.record_count}</td>
                      <td className="px-4 py-3 text-ink-muted">{a.message}</td>
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

function StatusDot({ connected, configured }: { connected: boolean; configured: boolean }) {
  const color = connected ? "#0a8a43" : configured ? "#f58231" : "#f58231";
  const label = connected ? "Connected" : configured ? "Configured" : "Waiting for credentials";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
