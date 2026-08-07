import { NextResponse } from "next/server";
import { requireOrg, assertOrg } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { pushDispatchPlan, dmsiLive, type DispatchPlan } from "@/lib/integrations/dmsi";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { clientIp } from "@/lib/integrations/net";

export const runtime = "nodejs";

// Push the consolidated plan for one finding back to DMSi dispatch. In
// simulation mode (DMSI_LIVE_MODE != true) the full path runs, the payload is
// saved to the audit log, and the request goes to the local mock endpoint.
export async function POST(request: Request) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.org.id;

  const rl = checkRateLimit(`dmsi-push:${clientIp(request)}`, { windowMs: 60_000, max: 60, hardBlock: 200 });
  if (!rl.ok) return NextResponse.json({ error: "Too Many Requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const body = await request.json().catch(() => ({}));
  const findingId = String(body?.findingId ?? "");
  if (!findingId) return NextResponse.json({ error: "findingId required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: finding } = await admin
    .from("consolidation_findings")
    .select("*")
    .eq("id", findingId)
    .maybeSingle();
  if (!finding) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const iso = await assertOrg(finding.org_id, orgId);
  if (iso) return iso;

  const plan = finding.consolidated_plan_json ?? {};
  const { data: groupRecs } = await admin
    .from("delivery_records")
    .select("id, route_id, customer_name, order_size, delivery_window")
    .in("id", plan.order_ids ?? []);
  const recs = groupRecs ?? [];

  const maxLoad = DEFAULT_CONFIG.vehicle_constraints.max_cargo_payload_lbs;
  const combined = recs.reduce((a, r) => a + (r.order_size ?? 0), 0);
  const primaryTruck = (plan.truck_ids ?? ["T-CONSOLIDATED"])[0];

  const dispatchPlan: DispatchPlan = {
    planDate: finding.date,
    generatedBy: guard.ctx.email ?? "route-consolidation-tool",
    trucksBefore: plan.distinct_trucks ?? recs.length,
    trucksAfter: plan.min_trucks_needed ?? 1,
    milesBefore: 0,
    milesAfter: 0,
    routes: [
      {
        truckId: primaryTruck,
        stops: recs.map((r, i) => ({
          orderNumber: r.route_id ?? r.id,
          customerName: r.customer_name ?? "",
          sequence: i + 1,
        })),
        totalWeightLbs: combined,
        totalMiles: 0,
      },
    ],
  };

  // Never send an illegal consolidation.
  if (combined > maxLoad * (plan.min_trucks_needed ?? 1)) {
    return NextResponse.json({ error: "Combined load exceeds legal payload — not sent" }, { status: 422 });
  }

  const origin = new URL(request.url).origin;
  const result = await pushDispatchPlan({
    orgId,
    plan: dispatchPlan,
    mockUrl: `${origin}/api/integrations/dmsi-mock`,
  });

  return NextResponse.json({ ...result, live: dmsiLive() });
}
