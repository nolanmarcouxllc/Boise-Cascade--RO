/**
 * Consolidation scheduler — SERVER ONLY. Ticks once a minute; a run fires for
 * an org when (a) a configured run_at time (just before each DMSi wave) has
 * passed since the last run, or (b) the fallback interval has elapsed. Cadence
 * comes from config dispatch_windows (YAML-mirrored, per-client).
 *
 * Runs in-process — correct for a persistent `next start`/dev server. On a
 * serverless deploy, point an external cron at POST /api/automation/run instead.
 * Disable with AUTOMATION_ENABLED=false.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { runAutomationForOrg } from "@/lib/automation/pipeline";

const TICK_MS = 60_000;
const FLAG = Symbol.for("bc.automation.scheduler");

export function startScheduler(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[FLAG]) return; // dev hot-reload guard
  g[FLAG] = true;

  if (process.env.AUTOMATION_ENABLED === "false") {
    console.log("[automation] scheduler disabled (AUTOMATION_ENABLED=false)");
    return;
  }
  const w = DEFAULT_CONFIG.dispatch_windows;
  console.log(
    `[automation] scheduler started — every ${w.interval_minutes} min, fixed runs at ${w.run_at.join(", ")}`,
  );
  setInterval(() => {
    tick().catch((e) => console.error("[automation] tick failed:", e?.message ?? e));
  }, TICK_MS);
}

async function tick(): Promise<void> {
  const admin = createAdminClient();
  // Orgs with work waiting.
  const { data } = await admin
    .from("order_queue")
    .select("org_id")
    .eq("status", "received")
    .limit(200);
  const orgIds = Array.from(new Set((data ?? []).map((r) => r.org_id as string)));
  if (orgIds.length === 0) return;

  const { interval_minutes, run_at } = DEFAULT_CONFIG.dispatch_windows;
  const now = new Date();

  for (const orgId of orgIds) {
    const { data: st } = await admin
      .from("integration_status")
      .select("updated_at")
      .eq("org_id", orgId)
      .eq("system", "automation")
      .maybeSingle();
    const last = st?.updated_at ? new Date(st.updated_at as string) : null;

    if (isDue(now, last, interval_minutes, run_at)) {
      console.log(`[automation] running consolidation for org ${orgId}`);
      try {
        const res = await runAutomationForOrg(orgId);
        console.log(`[automation] ${res.message}`);
      } catch (e) {
        console.error("[automation] run failed:", e instanceof Error ? e.message : e);
      }
    }
  }
}

function isDue(now: Date, last: Date | null, intervalMin: number, runAt: string[]): boolean {
  if (!last) return true;
  // Fallback interval elapsed?
  if (now.getTime() - last.getTime() >= intervalMin * 60_000) return true;
  // A fixed pre-wave run time passed since the last run today?
  for (const t of runAt) {
    const [hh, mm] = t.split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    const at = new Date(now);
    at.setHours(hh, mm, 0, 0);
    if (at <= now && at > last) return true;
  }
  return false;
}
