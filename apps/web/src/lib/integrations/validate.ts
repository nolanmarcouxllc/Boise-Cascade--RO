/**
 * Inbound payload validation + sanitization — SERVER ONLY. Every field from
 * DMSi, PC*MILER, or EDI is validated and clamped before it touches the
 * database. A batch with ANY invalid row is rejected wholesale (never a partial
 * write). Supabase queries are parameterized — no string interpolation anywhere.
 */

import "server-only";
import type { DeliveryInsert } from "@/lib/engine/csv";

const MAX_TEXT = 500;
const MAX_WEIGHT = 200000; // lbs; well above any legal single load, a sanity ceiling

function cleanText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, MAX_TEXT);
  return s.length ? s : null;
}

function cleanNum(v: unknown, min: number, max: number): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN as unknown as number; // signal invalid
  if (n < min || n > max) return NaN as unknown as number;
  return n;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ValidationResult =
  | { ok: true; rows: DeliveryInsert[] }
  | { ok: false; error: string; index: number };

/** Validate + sanitize a batch of delivery inserts. All-or-nothing. */
export function validateDeliveryRows(rows: DeliveryInsert[]): ValidationResult {
  const out: DeliveryInsert[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const lat = r.lat == null ? null : cleanNum(r.lat, -90, 90);
    const lng = r.lng == null ? null : cleanNum(r.lng, -180, 180);
    const weight = r.order_size == null ? null : cleanNum(r.order_size, 0, MAX_WEIGHT);
    if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(weight)) {
      return { ok: false, error: "coordinate or weight out of range", index: i };
    }
    if (r.delivery_date != null && !DATE_RE.test(r.delivery_date)) {
      return { ok: false, error: "delivery_date must be YYYY-MM-DD", index: i };
    }
    const name = cleanText(r.customer_name);
    const address = cleanText(r.address);
    if (!name && !address && lat == null) {
      return { ok: false, error: "row has no customer, address, or coordinates", index: i };
    }

    out.push({
      customer_name: name,
      address,
      delivery_date: r.delivery_date ?? null,
      delivery_window: cleanText(r.delivery_window),
      order_size: weight,
      truck_id: cleanText(r.truck_id),
      route_id: cleanText(r.route_id),
      lat,
      lng,
    });
  }
  return { ok: true, rows: out };
}
