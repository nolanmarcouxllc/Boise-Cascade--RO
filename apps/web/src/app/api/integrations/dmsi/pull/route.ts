import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { pullOrders, normalizeOrder, dmsiConfigured } from "@/lib/integrations/dmsi";
import { writeAudit } from "@/lib/integrations/audit";
import { recordSync } from "@/lib/integrations/status";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { clientIp } from "@/lib/integrations/net";
import { validateDeliveryRows } from "@/lib/integrations/validate";
import type { DeliveryInsert } from "@/lib/engine/csv";

export const runtime = "nodejs";

// Pull the day's released orders from DMSi and write them to delivery_records.
// When DMSi isn't configured, returns a mocked empty result (nothing written)
// so the UI shows the wiring is live and waiting for credentials.
export async function POST(request: Request) {
  const guard = await requireOrg();
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.org.id;

  const rl = checkRateLimit(`dmsi-pull:${clientIp(request)}`, { windowMs: 60_000, max: 60, hardBlock: 200 });
  if (!rl.ok) return NextResponse.json({ error: "Too Many Requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  let date = "";
  try {
    const body = await request.json();
    date = String(body?.date ?? "");
  } catch {
    /* optional */
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = new Date().toISOString().slice(0, 10);
  }

  const result = await pullOrders(date);

  if (result.mocked) {
    await writeAudit({
      orgId,
      sourceSystem: "dmsi",
      eventType: "pull_orders",
      status: "success",
      recordCount: 0,
      message: `Mocked pull for ${date} — DMSi not configured`,
    });
    return NextResponse.json({ mocked: true, configured: false, date, records: 0 });
  }

  if (result.error) {
    await writeAudit({ orgId, sourceSystem: "dmsi", eventType: "pull_orders", status: "failure", message: result.error });
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const admin = createAdminClient();
  const { data: upload } = await admin
    .from("uploads")
    .insert({ org_id: orgId, storage_path: `dmsi/orders/${date}`, status: "processed" })
    .select("id")
    .single();
  const mapped = result.orders.map((o) => normalizeOrder(o, orgId, upload?.id ?? null));
  // Validate before writing (all-or-nothing).
  const toValidate: DeliveryInsert[] = mapped.map((m) => ({
    customer_name: m.customer_name, address: m.address, delivery_date: m.delivery_date,
    delivery_window: m.delivery_window, order_size: m.order_size, truck_id: m.truck_id,
    route_id: m.route_id, lat: m.lat, lng: m.lng,
  }));
  const valid = validateDeliveryRows(toValidate);
  if (!valid.ok) {
    await writeAudit({ orgId, sourceSystem: "dmsi", eventType: "pull_orders", status: "rejected", message: `Validation failed at row ${valid.index}: ${valid.error}` });
    return NextResponse.json({ error: `Invalid order ${valid.index}: ${valid.error}` }, { status: 400 });
  }
  const rows = valid.rows.map((r) => ({ ...r, org_id: orgId, upload_id: upload?.id ?? null }));
  if (rows.length) await admin.from("delivery_records").insert(rows);

  await writeAudit({ orgId, sourceSystem: "dmsi", eventType: "pull_orders", status: "success", recordCount: rows.length, message: `Pulled ${rows.length} order(s) for ${date}` });
  await recordSync(orgId, "dmsi", rows.length, `Pulled ${date}`);

  return NextResponse.json({ mocked: false, configured: dmsiConfigured(), date, records: rows.length, uploadId: upload?.id });
}
