/**
 * In-memory rate limiter — SERVER ONLY. Fixed-window per key with a hard block
 * ceiling. Sufficient for a single persistent Node server (next start/dev); a
 * multi-instance deploy should back this with Redis/Upstash (same interface).
 *
 * Responses never reveal whether a limited request had valid credentials — the
 * limiter runs on the key (usually source IP) before any auth check.
 */

type Bucket = { count: number; resetAt: number; total: number; blockedUntil: number };
const buckets = new Map<string, Bucket>();

export type RateOptions = {
  windowMs: number; // soft window
  max: number; // requests per window before 429
  hardBlock?: number; // cumulative hits in window that trigger a longer block
  hardBlockMs?: number; // duration of the hard block
};

export function checkRateLimit(
  key: string,
  opts: RateOptions,
): { ok: true } | { ok: false; retryAfter: number } {
  const nowMs = Date.now();
  let b = buckets.get(key);
  if (!b || nowMs >= b.resetAt) {
    b = { count: 0, resetAt: nowMs + opts.windowMs, total: 0, blockedUntil: 0 };
    buckets.set(key, b);
  }

  if (b.blockedUntil > nowMs) {
    return { ok: false, retryAfter: Math.ceil((b.blockedUntil - nowMs) / 1000) };
  }

  b.count += 1;
  b.total += 1;

  if (opts.hardBlock && b.total > opts.hardBlock) {
    b.blockedUntil = nowMs + (opts.hardBlockMs ?? 15 * 60_000);
    return { ok: false, retryAfter: Math.ceil((b.blockedUntil - nowMs) / 1000) };
  }
  if (b.count > opts.max) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - nowMs) / 1000) };
  }
  return { ok: true };
}

// Opportunistic cleanup so the map doesn't grow unbounded.
export function sweepRateLimiter(): void {
  const nowMs = Date.now();
  for (const [k, b] of buckets) {
    if (nowMs >= b.resetAt && b.blockedUntil <= nowMs) buckets.delete(k);
  }
}
