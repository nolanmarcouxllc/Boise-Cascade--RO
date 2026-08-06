export function money(v: number | null | undefined, currency = "USD"): string {
  const n = typeof v === "number" ? v : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export function num(v: number | null | undefined, digits = 1): string {
  const n = typeof v === "number" ? v : 0;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(n);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Treat YYYY-MM-DD as a plain calendar date (no timezone shift).
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
