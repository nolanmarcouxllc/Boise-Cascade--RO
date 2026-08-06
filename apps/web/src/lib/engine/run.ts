// Orchestrates one analysis run: read this upload's delivery_records, detect
// candidates, quantify cost, write consolidation_findings, and flip the
// analysis_runs row to completed. Mirrors apps/engine/run.py's DB path.
//
// Runs server-side with the service-role client. Callers MUST pass an org_id
// they've already verified belongs to the acting user.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CONFIG } from "@/lib/config";
import { findCandidates, type Stop } from "@/lib/engine/detect";
import { quantify, toPlan } from "@/lib/engine/quantify";
import type { DeliveryRecord, RunTotals } from "@/lib/types";

export async function processRun(
  admin: SupabaseClient,
  opts: { orgId: string; uploadId: string; runId: string },
): Promise<void> {
  const { orgId, uploadId, runId } = opts;
  const config = DEFAULT_CONFIG;

  try {
    await admin
      .from("analysis_runs")
      .update({ status: "running" })
      .eq("id", runId);

    // 1) records for this upload
    const { data: records, error: recErr } = await admin
      .from("delivery_records")
      .select("*")
      .eq("org_id", orgId)
      .eq("upload_id", uploadId);
    if (recErr) throw recErr;

    const rows = (records ?? []) as DeliveryRecord[];

    // 2) resolve coordinates: use given lat/lng, else the org geocode_cache.
    const cache = await loadGeocodeCache(admin, orgId);
    const stops: Stop[] = [];
    let skipped = 0;
    for (const r of rows) {
      let lat = numOrNull(r.lat);
      let lng = numOrNull(r.lng);
      if ((lat === null || lng === null) && r.address && cache.has(r.address)) {
        [lat, lng] = cache.get(r.address)!;
      }
      if (lat === null || lng === null || !r.delivery_date || !r.truck_id) {
        skipped += 1;
        continue;
      }
      stops.push({
        order_id: r.id,
        date: r.delivery_date.slice(0, 10),
        customer_key: r.customer_name ?? r.id, // schema has no customer_id
        customer_name: r.customer_name ?? "(unnamed)",
        truck_id: r.truck_id,
        lat,
        lng,
      });
    }

    // 3) detect + quantify
    const groups = findCandidates(stops, config);
    const result = quantify(groups, config);

    // 4) write findings (idempotent: clear any prior findings for this run)
    await admin.from("consolidation_findings").delete().eq("run_id", runId);
    if (result.groups.length) {
      const findingRows = result.groups.map((q) => ({
        org_id: orgId,
        run_id: runId,
        customer_name: q.group.customer_names.join(", "),
        date: q.group.date,
        duplicate_trucks: q.redundant_trucks,
        wasted_miles: q.wasted_miles,
        wasted_hours: q.wasted_fleet_hours,
        est_cost_usd: q.cost_internal,
        consolidated_plan_json: toPlan(q),
      }));
      const { error: findErr } = await admin
        .from("consolidation_findings")
        .insert(findingRows);
      if (findErr) throw findErr;
    }

    // 5) complete the run, stash totals in params
    const totals: RunTotals = {
      ...result.totals,
      records_analyzed: stops.length,
      records_skipped_no_coords: skipped,
    };
    await admin
      .from("analysis_runs")
      .update({
        status: "completed",
        params: {
          engine: "web-ts",
          source: "db",
          detection: config.detection,
          costs: config.costs,
          totals,
        },
      })
      .eq("id", runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("analysis_runs")
      .update({
        status: "failed",
        params: {
          engine: "web-ts",
          source: "db",
          detection: config.detection,
          costs: config.costs,
          error: message,
        },
      })
      .eq("id", runId);
  }
}

async function loadGeocodeCache(
  admin: SupabaseClient,
  orgId: string,
): Promise<Map<string, [number, number]>> {
  const { data } = await admin
    .from("geocode_cache")
    .select("address, lat, lng")
    .eq("org_id", orgId);
  const map = new Map<string, [number, number]>();
  for (const row of data ?? []) {
    map.set(row.address as string, [Number(row.lat), Number(row.lng)]);
  }
  return map;
}

function numOrNull(v: number | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
