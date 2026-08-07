/**
 * Order queue — SERVER ONLY. Every inbound order (EDI, API push, CSV upload)
 * lands here with status 'received'; the consolidation scheduler drains it:
 * received -> consolidating -> dispatched (or failed). Each row keeps the raw
 * source payload alongside the normalized delivery_record it produced.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QueueSource = "edi" | "api" | "csv";

export type EnqueueItem = {
  recordId: string | null;
  orderNumber: string | null;
  dispatchDate: string | null; // YYYY-MM-DD
  raw: unknown;
};

export async function enqueueOrders(
  admin: SupabaseClient,
  orgId: string,
  source: QueueSource,
  items: EnqueueItem[],
): Promise<number> {
  if (items.length === 0) return 0;
  const rows = items.map((it) => ({
    org_id: orgId,
    source,
    status: "received",
    order_number: it.orderNumber,
    dispatch_date: it.dispatchDate,
    delivery_record_id: it.recordId,
    raw_payload: it.raw ?? null,
  }));
  const { error } = await admin.from("order_queue").insert(rows);
  if (error) throw new Error(`order_queue insert failed: ${error.message}`);
  return rows.length;
}

export async function markQueue(
  admin: SupabaseClient,
  ids: string[],
  status: "consolidating" | "dispatched" | "failed",
): Promise<void> {
  if (ids.length === 0) return;
  const patch: Record<string, unknown> = { status };
  if (status === "consolidating") patch.consolidated_at = new Date().toISOString();
  if (status === "dispatched") patch.dispatched_at = new Date().toISOString();
  await admin.from("order_queue").update(patch).in("id", ids);
}
