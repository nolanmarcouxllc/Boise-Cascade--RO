/**
 * EDI ingest — SERVER ONLY. Accepts EDI 204 (Motor Carrier Load Tender) and
 * EDI 211 (Motor Carrier Bill of Lading) from the Kleinschmidt gateway, verifies
 * an HMAC-SHA256 signature on every request, and parses into our
 * delivery_records shape. CSV upload is the fallback on the same write path.
 */

import "server-only";
import crypto from "node:crypto";
import type { DeliveryInsert } from "@/lib/engine/csv";

/** Timing-safe HMAC-SHA256 verification of a raw request body. */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  // Accept "sha256=<hex>" or bare hex.
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

type Segment = { id: string; el: string[] };

// X12 is segment-terminated (default '~') with '*' element separators. The ISA
// segment is fixed-width; we read the actual separators from it when present.
function tokenize(raw: string): Segment[] {
  let elementSep = "*";
  let segTerm = "~";
  if (raw.startsWith("ISA") && raw.length > 105) {
    elementSep = raw[3];
    segTerm = raw[105];
  }
  return raw
    .split(segTerm)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const el = s.split(elementSep);
      return { id: el[0], el };
    });
}

function docType(segs: Segment[]): "204" | "211" | "unknown" {
  const st = segs.find((s) => s.id === "ST");
  const code = st?.el[1];
  if (code === "204") return "204";
  if (code === "211") return "211";
  return "unknown";
}

// Convert a YYYYMMDD or CCYYMMDD EDI date to YYYY-MM-DD.
function ediDate(v: string | undefined): string | null {
  if (!v) return null;
  const d = v.length === 8 ? v : v.length === 6 ? "20" + v : "";
  if (!/^\d{8}$/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/**
 * Parse a load tender / BOL into delivery_records. One transaction can carry
 * multiple stops (N1*ST groups); we emit one record per ship-to.
 */
export function parseEdi(raw: string): {
  type: "204" | "211" | "unknown";
  records: DeliveryInsert[];
} {
  const segs = tokenize(raw);
  const type = docType(segs);
  if (type === "unknown") return { type, records: [] };

  const records: DeliveryInsert[] = [];
  const shipmentRef =
    segs.find((s) => s.id === "B2")?.el[4] ??
    segs.find((s) => s.id === "L11")?.el[1] ??
    segs.find((s) => s.id === "BOL")?.el[1] ??
    null;
  const shipmentDate = ediDate(segs.find((s) => s.id === "G62")?.el[2]);
  // AT8: 01=weight qualifier, 02=unit code, 03=weight.
  const totalWeight = Number(segs.find((s) => s.id === "AT8")?.el[3] ?? "") || null;

  // Walk segments, opening a new ship-to record at each N1*ST.
  let cur: Partial<DeliveryInsert> | null = null;
  const flush = () => {
    if (cur && (cur.customer_name || cur.address)) {
      records.push({
        customer_name: cur.customer_name ?? null,
        address: cur.address ?? null,
        delivery_date: cur.delivery_date ?? shipmentDate,
        delivery_window: cur.delivery_window ?? null,
        order_size: cur.order_size ?? totalWeight,
        truck_id: null,
        route_id: shipmentRef,
        lat: cur.lat ?? null,
        lng: cur.lng ?? null,
      });
    }
    cur = null;
  };

  for (const s of segs) {
    if (s.id === "N1") {
      // party. ST = ship-to; open a record for it.
      if (s.el[1] === "ST" || s.el[1] === "DE") {
        flush();
        cur = { customer_name: s.el[2] || null };
      }
    } else if (s.id === "N3" && cur) {
      cur.address = [cur.address, s.el.slice(1).filter(Boolean).join(" ")].filter(Boolean).join(", ");
    } else if (s.id === "N4" && cur) {
      const cityStateZip = [s.el[1], [s.el[2], s.el[3]].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      cur.address = [cur.address, cityStateZip].filter(Boolean).join(", ");
    } else if (s.id === "G62" && cur) {
      const d = ediDate(s.el[2]);
      if (d) cur.delivery_date = d;
    } else if ((s.id === "AT8" || s.id === "L0") && cur) {
      // AT8 weight = el[3]; L0 weight (line item) = el[4].
      const w = Number(s.id === "AT8" ? s.el[3] : s.el[4]);
      if (Number.isFinite(w) && w > 0) cur.order_size = w;
    }
  }
  flush();
  return { type, records };
}
