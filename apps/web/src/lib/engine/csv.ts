// Parse an uploaded delivery CSV into delivery_records rows. Tolerant of the
// common header variants a client TMS/WMS export might use. Mirrors the column
// mapping in apps/engine/ingest.py + db.py (weight -> order_size, address parts
// combined into a single address string).

import Papa from "papaparse";

export type DeliveryInsert = {
  customer_name: string | null;
  address: string | null;
  delivery_date: string | null; // YYYY-MM-DD
  delivery_window: string | null;
  order_size: number | null;
  truck_id: string | null;
  route_id: string | null;
  lat: number | null;
  lng: number | null;
};

export type ParseResult = {
  rows: DeliveryInsert[];
  rowCount: number;
  warnings: string[];
};

// Standard field -> accepted header aliases (all matched case-insensitively).
const ALIASES: Record<string, string[]> = {
  customer_name: ["customer_name", "customer", "account_name", "name"],
  customer_id: ["customer_id", "account", "account_id", "cust_id"],
  address: ["address", "street", "ship_to_address", "address1"],
  city: ["city", "town"],
  state: ["state", "st", "province"],
  zip: ["zip", "zipcode", "postal_code", "postal"],
  delivery_date: ["delivery_date", "date", "ship_date", "deliver_on"],
  delivery_window: ["delivery_window", "window", "time_window"],
  order_size: ["order_size", "weight_lbs", "weight", "size", "quantity", "qty"],
  truck_id: ["truck_id", "truck", "vehicle", "vehicle_id", "unit"],
  route_id: ["route_id", "route", "run"],
  lat: ["lat", "latitude"],
  lng: ["lng", "lon", "long", "longitude"],
};

export function parseDeliveryCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const warnings: string[] = [];
  if (parsed.errors.length) {
    warnings.push(
      `${parsed.errors.length} CSV parse issue(s); first: ${parsed.errors[0].message}`,
    );
  }

  const headers = (parsed.meta.fields ?? []).map((h) => h.toLowerCase());
  const col = (field: string): string | null => {
    for (const alias of ALIASES[field] ?? []) {
      if (headers.includes(alias)) return alias;
    }
    return null;
  };
  const map = Object.fromEntries(
    Object.keys(ALIASES).map((f) => [f, col(f)]),
  ) as Record<string, string | null>;

  if (!map.truck_id) {
    warnings.push(
      "No truck/route column found — consolidation detection needs a truck id per stop.",
    );
  }

  const rows: DeliveryInsert[] = [];
  for (const raw of parsed.data) {
    const get = (field: string): string => {
      const c = map[field];
      return c ? (raw[c] ?? "").trim() : "";
    };

    const name = get("customer_name") || get("customer_id") || null;
    const address = joinAddress(
      get("address"),
      get("city"),
      get("state"),
      get("zip"),
    );

    rows.push({
      customer_name: name,
      address: address || null,
      delivery_date: normalizeDate(get("delivery_date")),
      delivery_window: get("delivery_window") || null,
      order_size: toNum(get("order_size")),
      truck_id: get("truck_id") || null,
      route_id: get("route_id") || null,
      lat: toNum(get("lat")),
      lng: toNum(get("lng")),
    });
  }

  return { rows, rowCount: rows.length, warnings };
}

function joinAddress(
  street: string,
  city: string,
  state: string,
  zip: string,
): string {
  const tail = [state, zip].filter(Boolean).join(" ");
  return [street, city, tail].filter(Boolean).join(", ");
}

function toNum(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Accept YYYY-MM-DD, M/D/YYYY, etc. -> YYYY-MM-DD, or null.
function normalizeDate(v: string): string | null {
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    let [, mm, dd, yy] = us;
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}
