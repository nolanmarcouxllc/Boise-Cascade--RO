/**
 * Automated consolidation pipeline — SERVER ONLY.
 * Drains the order queue for an org: received -> consolidating, builds the
 * dispatch plan (baseline blind-per-wave vs consolidated full-day), and stores
 * it in optimized_plans. Routing geometry and the DMSi push are the next stages
 * of this same run. Triggered by the scheduler or POST /api/automation/run.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { buildDispatchPlan, type PlanOrder } from "@/lib/automation/planner";
import { markQueue } from "@/lib/automation/queue";
import { writeAudit } from "@/lib/integrations/audit";
import { recordSync } from "@/lib/integrations/status";
import { resolveWithCache } from "@/lib/integrations/geometry-cache";
import { activeProvider, type LatLng } from "@/lib/routing";
import { pcmilerConfigured, pcmilerMileage } from "@/lib/pcmiler";

export type AutomationResult = {
  orders: number;
  planId: string | null;
  trucksBefore: number;
  trucksAfter: number;
  recoverable: number;
  message: string;
};

let running = false; // in-process concurrency guard

export async function runAutomationForOrg(orgId: string): Promise<AutomationResult> {
  if (running) return { orders: 0, planId: null, trucksBefore: 0, trucksAfter: 0, recoverable: 0, message: "Run already in progress" };
  running = true;
  try {
    return await run(orgId);
  } finally {
    running = false;
  }
}

async function run(orgId: string): Promise<AutomationResult> {
  const admin = createAdminClient();
  const config = DEFAULT_CONFIG;

  // 1) Drain the queue.
  const { data: queued } = await admin
    .from("order_queue")
    .select("id, order_number, dispatch_date, delivery_record_id")
    .eq("org_id", orgId)
    .eq("status", "received")
    .order("received_at", { ascending: true })
    .limit(500);
  const rows = queued ?? [];
  if (rows.length === 0) {
    await recordSync(orgId, "automation", 0, "No orders in queue");
    return { orders: 0, planId: null, trucksBefore: 0, trucksAfter: 0, recoverable: 0, message: "No orders in queue" };
  }
  await markQueue(admin, rows.map((r) => r.id as string), "consolidating");

  try {
    // 2) Load the normalized records behind the queue rows.
    const recordIds = rows.map((r) => r.delivery_record_id as string).filter(Boolean);
    const { data: recs } = await admin
      .from("delivery_records")
      .select("id, route_id, customer_name, address, delivery_date, delivery_window, order_size, lat, lng")
      .in("id", recordIds);

    const orders: PlanOrder[] = [];
    const unroutable: string[] = [];
    for (const q of rows) {
      const r = (recs ?? []).find((x) => x.id === q.delivery_record_id);
      if (!r || r.lat == null || r.lng == null || !r.delivery_date) {
        unroutable.push(q.id as string);
        continue;
      }
      orders.push({
        recordId: r.id as string,
        orderNumber: (r.route_id as string) ?? (q.order_number as string),
        customer: (r.customer_name as string) ?? "(unnamed)",
        address: r.address as string,
        lat: Number(r.lat),
        lng: Number(r.lng),
        weightLbs: Number(r.order_size ?? 0),
        wave: (r.delivery_window as string) ?? "—",
        date: String(r.delivery_date).slice(0, 10),
      });
    }
    if (unroutable.length) await markQueue(admin, unroutable, "failed");
    if (orders.length === 0) {
      await recordSync(orgId, "automation", 0, "Queue had no routable orders");
      return { orders: 0, planId: null, trucksBefore: 0, trucksAfter: 0, recoverable: 0, message: "No routable orders" };
    }

    // 3) Consolidate: blind per-wave baseline vs full-day plan.
    const plan = buildDispatchPlan(orders, config);

    // 3b) AUTOMATED ROUTING: resolve real road geometry for every consolidated
    // truck (PC*MILER commercial routing when keyed, OSRM fallback) and cache
    // it in route_geometry_cache. With a PC*MILER key, replace the haversine
    // estimate with commercial truck mileage per route.
    const depotPt: LatLng = [config.costs.depot.lat, config.costs.depot.lng];
    const allRoutes = plan.days.flatMap((d) => d.routes);
    const legs: LatLng[][] = allRoutes.map((r) => [
      depotPt,
      ...r.stops.map((s) => [s.lat, s.lng] as LatLng),
      depotPt,
    ]);
    await resolveWithCache(orgId, legs); // caches; map + editor read from here
    if (pcmilerConfigured()) {
      for (let i = 0; i < allRoutes.length; i++) {
        const m = await pcmilerMileage(legs[i]);
        if (m) allRoutes[i].miles = Math.round(m.miles * 10) / 10;
      }
    }
    await writeAudit({
      orgId,
      sourceSystem: "pcmiler",
      eventType: "auto_routing",
      direction: "outbound",
      status: "success",
      recordCount: allRoutes.length,
      message: `Routed ${allRoutes.length} consolidated truck(s) via ${activeProvider()}`,
    });

    // 4) Persist the plan.
    const planJson = {
      generatedAt: new Date().toISOString(),
      dates: plan.days.map((d) => d.date),
      routingProvider: activeProvider(),
      summary: plan.summary,
      queueIds: rows.map((r) => r.id),
      routes: plan.days.flatMap((d) =>
        d.routes.map((r) => ({
          truckId: r.truckId,
          date: d.date,
          totalWeightLbs: r.totalWeightLbs,
          miles: r.miles,
          stops: r.stops.map((s, i) => ({
            sequence: i + 1,
            recordId: s.recordId,
            orderNumber: s.orderNumber,
            customer: s.customer,
            address: s.address,
            weightLbs: s.weightLbs,
            wave: s.wave,
            lat: s.lat,
            lng: s.lng,
          })),
        })),
      ),
    };
    const { data: planRow, error: planErr } = await admin
      .from("optimized_plans")
      .insert({
        org_id: orgId,
        plan: planJson,
        trucks_before: plan.summary.trucksBefore,
        trucks_after: plan.summary.trucksAfter,
        miles_before: plan.summary.milesBefore,
        miles_after: plan.summary.milesAfter,
      })
      .select("id")
      .single();
    if (planErr || !planRow) throw new Error(planErr?.message ?? "plan insert failed");
    const planId = planRow.id as string;

    const message =
      `${plan.summary.loads} loads -> ${plan.summary.trucksAfter} trucks ` +
      `(blind dispatch would use ${plan.summary.trucksBefore}); ` +
      `$${plan.summary.recoverable.toLocaleString()} recoverable`;
    await writeAudit({
      orgId,
      sourceSystem: "optimizer",
      eventType: "auto_consolidation",
      direction: "inbound",
      status: "success",
      recordCount: orders.length,
      message,
      payload: { planId, summary: plan.summary },
    });
    await recordSync(orgId, "automation", orders.length, message);

    return {
      orders: orders.length,
      planId,
      trucksBefore: plan.summary.trucksBefore,
      trucksAfter: plan.summary.trucksAfter,
      recoverable: plan.summary.recoverable,
      message,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "automation run failed";
    await markQueue(admin, rows.map((r) => r.id as string), "failed");
    await writeAudit({ orgId, sourceSystem: "optimizer", eventType: "auto_consolidation", status: "failure", message: msg });
    await recordSync(orgId, "automation", 0, `ERROR: ${msg}`);
    throw e;
  }
}
