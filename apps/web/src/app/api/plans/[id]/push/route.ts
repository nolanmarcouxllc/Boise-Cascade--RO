import { NextResponse } from "next/server";
import { requireOrg, assertOrg } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG } from "@/lib/config";
import { pushDispatchPlan, dmsiLive, type DispatchPlan } from "@/lib/integrations/dmsi";

export const runtime = "nodejs";

// Re-push a (possibly overridden) plan to DMSi dispatch. Same simulation gate
// as every DMSi write; blocks any truck over the legal payload.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.org.id;
  const admin = createAdminClient();

  const { data: row } = await admin.from("optimized_plans").select("*").eq("id", params.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const iso = await assertOrg(row.org_id, orgId);
  if (iso) return iso;

  const routes = (row.plan?.routes ?? []) as {
    truckId: string; date: string; totalWeightLbs: number; miles: number;
    stops: { orderNumber: string | null; recordId: string; customer: string }[];
  }[];
  if (routes.length === 0) return NextResponse.json({ error: "Plan has no routes" }, { status: 400 });

  const cap = DEFAULT_CONFIG.vehicle_constraints.max_cargo_payload_lbs;
  const over = routes.find((r) => r.totalWeightLbs > cap);
  if (over) {
    return NextResponse.json(
      { error: `Truck ${over.truckId} exceeds legal payload — not sent` },
      { status: 422 },
    );
  }

  const dispatchPlan: DispatchPlan = {
    planDate: routes[0].date,
    generatedBy: guard.ctx.email ?? "dispatcher-override",
    trucksBefore: (row.trucks_before as number) ?? routes.length,
    trucksAfter: routes.length,
    milesBefore: Number(row.miles_before ?? 0),
    milesAfter: Number(row.miles_after ?? 0),
    routes: routes.map((r) => ({
      truckId: r.truckId,
      stops: r.stops.map((s, i) => ({
        orderNumber: s.orderNumber ?? s.recordId,
        customerName: s.customer,
        sequence: i + 1,
      })),
      totalWeightLbs: r.totalWeightLbs,
      totalMiles: r.miles,
    })),
  };

  const origin = new URL(request.url).origin;
  const res = await pushDispatchPlan({
    orgId,
    plan: dispatchPlan,
    mockUrl: `${origin}/api/integrations/dmsi-mock`,
  });
  await admin
    .from("optimized_plans")
    .update({ plan: { ...row.plan, pushedAt: new Date().toISOString(), pushMode: res.mode, repushedBy: guard.ctx.email } })
    .eq("id", params.id);

  return NextResponse.json({ ...res, live: dmsiLive() });
}
