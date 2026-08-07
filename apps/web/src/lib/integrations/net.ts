/**
 * Network helpers for integration endpoints — SERVER ONLY.
 * Client IP extraction + IPv4 CIDR allowlisting for the DMSi/Kleinschmidt and
 * PC*MILER server ranges. Empty allowlist = allow all (dev default).
 */

import "server-only";

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/** True if `ip` is permitted by INTEGRATION_IP_ALLOWLIST (empty => allow all). */
export function ipAllowed(ip: string): boolean {
  const raw = (process.env.INTEGRATION_IP_ALLOWLIST || "").trim();
  if (!raw) return true; // dev default; production must set this
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .some((cidr) => inCidr(ip, cidr));
}
