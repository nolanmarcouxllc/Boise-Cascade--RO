import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySignature, parseEdi } from "@/lib/integrations/edi";
import { parseDeliveryCsv, type DeliveryInsert } from "@/lib/engine/csv";
import { writeAudit } from "@/lib/integrations/audit";
import { recordSync } from "@/lib/integrations/status";
import { clientIp, ipAllowed } from "@/lib/integrations/net";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { validateDeliveryRows } from "@/lib/integrations/validate";

export const runtime = "nodejs";

// PUBLIC endpoint. Trust is established by HMAC-SHA256 over the raw body +
// IP allowlist, NOT by a user session. Accepts EDI 204/211 or CSV fallback.
// Signature header: X-EDI-Signature (sha256=<hex> or bare hex).
// Org routing: X-Org-Id header (validated against orgs).
export async function POST(request: Request) {
  const ip = clientIp(request);

  // Rate limit first (cheap) — never reveal whether creds were valid.
  const rl = checkRateLimit(`edi:${ip}`, { windowMs: 60_000, max: 60, hardBlock: 200 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const orgId = request.headers.get("x-org-id");
  const rawBody = await request.text();

  // IP allowlist.
  if (!ipAllowed(ip)) {
    if (orgId) await writeAudit({ orgId, sourceSystem: "edi", eventType: "rejected", status: "rejected", message: "IP not allowlisted", sourceIp: ip });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // HMAC verification.
  const secret = process.env.EDI_SHARED_SECRET || "";
  const sig = request.headers.get("x-edi-signature");
  if (!verifySignature(rawBody, sig, secret)) {
    if (orgId) await writeAudit({ orgId, sourceSystem: "edi", eventType: "rejected", status: "rejected", message: "Invalid HMAC signature", sourceIp: ip });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Org resolution (must be a real org).
  const admin = createAdminClient();
  if (!orgId) return NextResponse.json({ error: "Missing X-Org-Id" }, { status: 400 });
  const { data: org } = await admin.from("orgs").select("id").eq("id", orgId).maybeSingle();
  if (!org) return NextResponse.json({ error: "Unknown org" }, { status: 400 });

  // Parse: CSV fallback if content-type is CSV or body looks like a header row.
  const ct = request.headers.get("content-type") || "";
  let type = "unknown";
  let records: DeliveryInsert[] = [];
  if (ct.includes("csv") || /^order_id|customer|delivery_date/i.test(rawBody.slice(0, 200))) {
    const parsed = parseDeliveryCsv(rawBody);
    type = "csv";
    records = parsed.rows;
  } else {
    const parsed = parseEdi(rawBody);
    type = parsed.type;
    records = parsed.records;
  }

  if (records.length === 0) {
    await writeAudit({ orgId, sourceSystem: "edi", eventType: type, status: "failure", message: "No records parsed", sourceIp: ip });
    return NextResponse.json({ error: "No records parsed", type }, { status: 400 });
  }

  // Validate + sanitize every row; reject the whole batch on any bad field
  // (no partial writes).
  const valid = validateDeliveryRows(records);
  if (!valid.ok) {
    await writeAudit({ orgId, sourceSystem: "edi", eventType: type, status: "rejected", message: `Validation failed at row ${valid.index}: ${valid.error}`, sourceIp: ip });
    return NextResponse.json({ error: `Invalid row ${valid.index}: ${valid.error}` }, { status: 400 });
  }
  records = valid.rows;

  // Write on the standard delivery_records path (one upload per inbound doc).
  const { data: upload } = await admin
    .from("uploads")
    .insert({ org_id: orgId, storage_path: `edi/${type}/${new Date().toISOString()}`, status: "processed" })
    .select("id")
    .single();

  const rows = records.map((r) => ({ ...r, org_id: orgId, upload_id: upload?.id ?? null }));
  const { error: insErr } = await admin.from("delivery_records").insert(rows);
  if (insErr) {
    await writeAudit({ orgId, sourceSystem: "edi", eventType: type, status: "failure", message: insErr.message, sourceIp: ip });
    return NextResponse.json({ error: "Write failed" }, { status: 500 });
  }

  await writeAudit({ orgId, sourceSystem: "edi", eventType: type, status: "success", recordCount: rows.length, message: `Ingested ${rows.length} record(s)`, sourceIp: ip });
  await recordSync(orgId, "edi", rows.length, `Last ${type.toUpperCase()} ingest`);

  return NextResponse.json({ ok: true, type, records: rows.length });
}
