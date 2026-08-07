import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDeliveryCsv } from "@/lib/engine/csv";
import { enqueueOrders } from "@/lib/automation/queue";

export const runtime = "nodejs";

const BUCKET = "deliveries";

// Accepts a delivery CSV (multipart form field "file"). Stores the raw file in
// the private Storage bucket, records an uploads row, and parses the CSV into
// delivery_records for the caller's org. Service role is used for Storage +
// bulk insert, after the caller's org is resolved from their session.
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!ctx.org) {
    return NextResponse.json({ error: "No organization." }, { status: 403 });
  }
  const orgId = ctx.org.id;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }

  const text = await file.text();
  const parsed = parseDeliveryCsv(text);
  if (parsed.rowCount === 0) {
    return NextResponse.json(
      { error: "No delivery rows found in the CSV." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectKey = `${orgId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(objectKey, file, {
      contentType: file.type || "text/csv",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      { error: `Storage upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  const { data: upload, error: insErr } = await admin
    .from("uploads")
    .insert({
      org_id: orgId,
      storage_path: objectKey,
      status: "processed",
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single();
  if (insErr || !upload) {
    return NextResponse.json(
      { error: insErr?.message ?? "Could not record upload." },
      { status: 500 },
    );
  }

  const recordRows = parsed.rows.map((r) => ({
    ...r,
    org_id: orgId,
    upload_id: upload.id,
  }));
  const { data: inserted, error: recErr } = await admin
    .from("delivery_records")
    .insert(recordRows)
    .select("id, route_id, delivery_date");
  if (recErr) {
    return NextResponse.json(
      { error: `Records insert failed: ${recErr.message}` },
      { status: 500 },
    );
  }

  // CSV is the fallback entry point — it feeds the same order queue and goes
  // through the same consolidation engine as EDI and API push.
  await enqueueOrders(
    admin,
    orgId,
    "csv",
    (inserted ?? []).map((r, i) => ({
      recordId: r.id as string,
      orderNumber: (r.route_id as string) ?? null,
      dispatchDate: ((r.delivery_date as string) ?? "").slice(0, 10) || null,
      raw: parsed.rows[i],
    })),
  );

  return NextResponse.json({
    uploadId: upload.id,
    recordCount: parsed.rowCount,
    warnings: parsed.warnings,
  });
}
