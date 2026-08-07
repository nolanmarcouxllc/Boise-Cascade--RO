import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getIntegrationStatus, SYSTEM_DESCRIPTIONS } from "@/lib/integrations/status";
import { shortDate } from "@/lib/format";
import { IntegrationArchitecture } from "@/components/integration-architecture";
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

  // ---- Automation feed (Steve's ops view) --------------------------------
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [{ data: autoStatus }, { data: queueRows }, { count: pushesToday }, { count: routingToday }, { data: errorsToday }] =
    await Promise.all([
      supabase.from("integration_status").select("last_sync_at, detail").eq("system", "automation").maybeSingle(),
      supabase.from("order_queue").select("status"),
      supabase
        .from("integration_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "push_plan")
        .gte("created_at", todayIso),
      supabase
        .from("integration_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "auto_routing")
        .gte("created_at", todayIso),
      supabase
        .from("integration_audit_log")
        .select("message, created_at, source_system")
        .eq("status", "failure")
        .gte("created_at", todayIso)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

  const queueCounts: Record<string, number> = {};
  for (const r of queueRows ?? []) {
    const s = (r as { status: string }).status;
    queueCounts[s] = (queueCounts[s] ?? 0) + 1;
  }
  const automation = {
    lastRunAt: (autoStatus?.last_sync_at as string) ?? null,
    lastRunDetail: (autoStatus?.detail as string) ?? null,
    queued: queueCounts["received"] ?? 0,
    consolidating: queueCounts["consolidating"] ?? 0,
    dispatched: queueCounts["dispatched"] ?? 0,
    failed: queueCounts["failed"] ?? 0,
    pushesToday: pushesToday ?? 0,
    routingToday: routingToday ?? 0,
    errors: (errorsToday ?? []) as { message: string | null; created_at: string; source_system: string }[],
  };
  const healthy = automation.errors.length === 0 && automation.failed === 0;
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
        <h1 className="text-2xl font-semibold text-ink">Connected systems</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          This tool is the bridge between your order system and your routing
          system — it makes sure orders are grouped efficiently before routes are
          built. Here&apos;s the live status of each connection: green means
          connected and working, amber means ready and waiting to be connected.
        </p>
      </div>

      <IntegrationArchitecture />

      {/* Automation feed — reads like a morning briefing, not a system log */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">
            What the system did on its own
          </h2>
          <span className={`badge ${healthy ? "badge-green" : "badge-crimson"}`}>
            {healthy ? "● Running smoothly" : "● Something needs attention"}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          This tool reviews incoming orders automatically throughout the day and
          groups them onto the fewest trucks before your dispatch team builds
          routes — no one has to press a button.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink">
          {briefing(automation.lastRunAt, automation.lastRunDetail)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <FeedStat label="Orders waiting to be planned" value={String(automation.queued)} alert={automation.queued > 0} />
          <FeedStat label="Being grouped right now" value={String(automation.consolidating)} />
          <FeedStat label="Sent out (all time)" value={String(automation.dispatched)} />
          <FeedStat label="Plans sent to dispatch today" value={String(automation.pushesToday)} />
          <FeedStat label="Routes calculated today" value={String(automation.routingToday)} />
        </div>
        {automation.errors.length > 0 && (
          <div className="mt-3 rounded-lg border border-alert/30 bg-alert/10 p-3">
            <p className="mb-1 text-xs font-semibold text-alert">What went wrong:</p>
            {automation.errors.map((e, i) => (
              <p key={i} className="text-xs text-alert">
                {new Date(e.created_at).toLocaleTimeString()} · {e.source_system.toUpperCase()} — {e.message}
              </p>
            ))}
          </div>
        )}
        {automation.failed > 0 && (
          <p className="mt-2 text-xs text-alert">
            {automation.failed} order(s) couldn&apos;t be planned because they were
            missing an address location or delivery date.
          </p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {statuses.map((s) => (
          <div key={s.system} className="panel p-5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{s.label}</span>
              <StatusDot connected={s.connected} configured={s.configured} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">
              {SYSTEM_DESCRIPTIONS[s.system]}
            </p>
            <p className="mt-2 text-sm text-ink-muted">{s.detail}</p>
            <dl className="mt-4 space-y-1 text-xs text-ink-faint">
              <div className="flex justify-between">
                <dt>Last time data came through</dt>
                <dd className="text-ink-muted">{s.lastSyncAt ? shortDate(s.lastSyncAt) : "Not yet"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Orders received so far</dt>
                <dd className="tabular-nums text-ink-muted">{s.lastRecordCount}</dd>
              </div>
              {s.system === "dmsi" && (
                <div className="flex justify-between">
                  <dt>Mode</dt>
                  <dd className={s.liveMode ? "text-alert" : "text-ink-muted"}>
                    {s.liveMode ? "LIVE — real dispatch" : "Practice mode"}
                  </dd>
                </div>
              )}
            </dl>
            {s.system === "dmsi" && <DmsiPullButton />}
          </div>
        ))}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-medium text-ink">
          Automatic Order Feed — setup details for your IT team
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          This is the address where order documents arrive automatically from
          trading partners (via the Kleinschmidt network). Every incoming
          document must carry a valid security signature — anything unsigned or
          from an unknown sender is turned away and logged.
        </p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[190px_1fr]">
          <dt className="text-ink-faint">Where documents are sent</dt>
          <dd className="font-mono text-ink">POST {ediPath}</dd>
          <dt className="text-ink-faint">Formats accepted</dt>
          <dd className="text-ink-muted">
            EDI 204 (load tender), EDI 211 (bill of lading), or a plain
            spreadsheet (CSV)
          </dd>
          <dt className="text-ink-faint">Required security headers</dt>
          <dd className="font-mono text-ink">X-EDI-Signature, X-Org-Id</dd>
          <dt className="text-ink-faint">Your company ID</dt>
          <dd className="font-mono text-ink">{ctx.org.id}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">
          Recent activity — every time data moved between systems
        </h2>
        {audit.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-ink-muted">
            Nothing has moved between systems yet.
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

// Turn the last automation run into a morning-briefing sentence.
// Run details look like: "12 loads -> 4 trucks (blind dispatch would use 5);
// $1,132.42 recoverable; pushed to DMSi (simulation)".
function briefing(lastRunAt: string | null, detail: string | null): string {
  if (!lastRunAt) {
    return "The system hasn't run yet — as soon as orders arrive, it will review and group them automatically.";
  }
  const when = new Date(lastRunAt).toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  const m = detail?.match(
    /(\d+) loads -> (\d+) trucks \(blind dispatch would use (\d+)\); \$([\d,.]+) recoverable/,
  );
  if (m) {
    const [, loads, after, before, dollars] = m;
    const practice = detail?.includes("simulation") ? " (in practice mode — nothing sent to the live system yet)" : "";
    return `On ${when}, the system automatically reviewed all pending orders, combined ${loads} deliveries onto ${after} trucks instead of ${before}, and sent the plan to your dispatch team${practice} — saving an estimated $${dollars}.`;
  }
  if (detail?.startsWith("No orders")) {
    return `On ${when}, the system checked for new orders — there was nothing waiting to plan.`;
  }
  if (detail?.startsWith("ERROR")) {
    return `On ${when}, the system tried to run but hit a problem: ${detail.replace("ERROR: ", "")}`;
  }
  return `On ${when}, the system last reviewed your orders. ${detail ?? ""}`;
}

function FeedStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-surface-2 p-3">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${alert ? "text-geo" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function StatusDot({ connected, configured }: { connected: boolean; configured: boolean }) {
  const color = connected ? "#0a8a43" : configured ? "#f58231" : "#f58231";
  const label = connected ? "Connected" : configured ? "Ready — not yet used" : "Waiting to be connected";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
