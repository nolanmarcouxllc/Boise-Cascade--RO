import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionContext } from "@/lib/auth";
import { verifySignature } from "@/lib/integrations/edi";
import { validateDeliveryRows } from "@/lib/integrations/validate";
import type { DeliveryInsert } from "@/lib/engine/csv";
import { enqueueOrders } from "@/lib/automation/queue";
import { writeAudit } from "@/lib/integrations/audit";
import { recordSync } from "@/lib/integrations/status";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { clientIp, ipAllowed } from "@/lib/integrations/net";

export const runtime = "nodejs";

// API push entry point: DMSi (or any system) POSTs a JSON batch of orders.
// Auth: either an authenticated dashboard session, or — for server-to-server —
// the same HMAC-SHA256 scheme as the EDI webhook (X-EDI-Signature + X-Org-Id).
// All orders land in delivery_records AND the order_queue (source 'api') for
// the consolidation scheduler.
//
// Body: { orders: [{ orderNumber, customerName, address?, city?, state?, zip?,
//   deliveryDate: 'YYYY-MM-DD', dispatchWave?, weightLbs?, lat?, lng? }] }
export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = checkRateLimit(`orders:${ip}`, { windowMs: 60_000, max: 60, hardBlock: 200 });
  if (!rl.ok) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }

  const rawBody = await request.text();

  // Resolve caller: session first, else HMAC.
  let orgId: string | null = null;
  const session = await getSessionContext();
  if (session?.org) {
    orgId = session.org.id;
  } else {
    if (!ipAllowed(ip)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const secret = process.env.EDI_SHARED_SECRET || "";
    const sig = request.headers.get("x-edi-signature");
    if (!verifySignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    orgId = request.headers.get("x-org-id");
  }
  const admin = createAdminClient();
  if (!orgId) return NextResponse.json({ error: "Missing org" }, { status: 400 });
  const { data: org } = await admin.from("orgs").select("id").eq("id", orgId).maybeSingle();
  if (!org) return NextResponse.json({ error: "Unknown org" }, { status: 400 });

  let orders: Record<string, unknown>[] = [];
  try {
    const body = JSON.parse(rawBody);
    orders = Array.isArray(body?.orders) ? body.orders : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (orders.length === 0 || orders.length > 500) {
    return NextResponse.json({ error: "orders must contain 1-500 items" }, { status: 400 });
  }

  // Normalize to the standard shape, then validate all-or-nothing.
  const mapped: DeliveryInsert[] = orders.map((o) => ({
    customer_name: str(o.customerName),
    address: [str(o.address), str(o.city), [str(o.state), str(o.zip)].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ") || null,
    delivery_date: str(o.deliveryDate),
    delivery_window: str(o.dispatchWave),
    order_size: numOrNull(o.weightLbs),
    truck_id: null, // not yet dispatched — that's the point of the queue
    route_id: str(o.orderNumber),
    lat: numOrNull(o.lat),
    lng: numOrNull(o.lng),
  }));
  const valid = validateDeliveryRows(mapped);
  if (!valid.ok) {
    await writeAudit({ orgId, sourceSystem: "dmsi", eventType: "api_push_orders", status: "rejected", message: `Validation failed at row ${valid.index}: ${valid.error}`, sourceIp: ip });
    return NextResponse.json({ error: `Invalid order ${valid.index}: ${valid.error}` }, { status: 400 });
  }

  const { data: upload } = await admin
    .from("uploads")
    .insert({ org_id: orgId, storage_path: `api/orders/${new Date().toISOString()}`, status: "processed" })
    .select("id")
    .single();
  const rows = valid.rows.map((r) => ({ ...r, org_id: orgId, upload_id: upload?.id ?? null }));
  const { data: inserted, error: insErr } = await admin
    .from("delivery_records")
    .insert(rows)
    .select("id, route_id, delivery_date");
  if (insErr) {
    await writeAudit({ orgId, sourceSystem: "dmsi", eventType: "api_push_orders", status: "failure", message: insErr.message, sourceIp: ip });
    return NextResponse.json({ error: "Write failed" }, { status: 500 });
  }

  const queued = await enqueueOrders(
    admin,
    orgId,
    "api",
    (inserted ?? []).map((r, i) => ({
      recordId: r.id as string,
      orderNumber: (r.route_id as string) ?? null,
      dispatchDate: ((r.delivery_date as string) ?? "").slice(0, 10) || null,
      raw: orders[i],
    })),
  );

  await writeAudit({ orgId, sourceSystem: "dmsi", eventType: "api_push_orders", status: "success", recordCount: queued, message: `Queued ${queued} order(s) via API push`, sourceIp: ip });
  await recordSync(orgId, "dmsi", queued, "API push");

  return NextResponse.json({ ok: true, queued });
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
