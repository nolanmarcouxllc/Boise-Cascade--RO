/**
 * Public demo mode — SERVER ONLY.
 *
 * The whole app is a shareable, read-only demo of one org's synthetic Westfield
 * data. When enabled (the default), visitors don't have to log in: pages render
 * as a "guest" pinned to the demo org, and the read APIs serve that org's data.
 * WRITES stay protected — getSessionContext() still returns null for guests, so
 * every upload/analyze/push/integration endpoint keeps rejecting them.
 *
 * Turn it off (require login again) by setting PUBLIC_DEMO="off".
 *
 * NOTE: this is single-tenant by design. Because guest page reads go through the
 * service-role client (no row-level security), any org's rows in this database
 * would be publicly readable. That's fine while this project holds only the
 * synthetic demo org; do NOT enable public mode on a database with real
 * customer data from multiple orgs.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Org } from "@/lib/types";

export function publicDemoEnabled(): boolean {
  return (process.env.PUBLIC_DEMO ?? "on").toLowerCase() !== "off";
}

let cachedOrg: Org | null = null;

/** The org whose synthetic data the public demo shows: the one that owns real
 *  analyzed runs, falling back to the earliest org. Cached once resolved. */
export async function resolvePublicOrg(): Promise<Org | null> {
  if (cachedOrg) return cachedOrg;
  const admin = createAdminClient();

  const { data: runData } = await admin
    .from("analysis_runs")
    .select("org_id, params, created_at")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);
  const runs = (runData ?? []) as {
    org_id: string | null;
    params: { totals?: { records_analyzed?: number } } | null;
  }[];
  let orgId: string | null = null;
  for (const r of runs) {
    if ((r.params?.totals?.records_analyzed ?? 0) > 0) {
      orgId = r.org_id;
      break;
    }
  }

  const query = admin.from("orgs").select("id, name, created_at");
  const { data: org } = orgId
    ? await query.eq("id", orgId).maybeSingle()
    : await query.order("created_at", { ascending: true }).limit(1).maybeSingle();

  cachedOrg = (org as Org) ?? null; // only caches non-null (retries until data exists)
  return cachedOrg;
}
