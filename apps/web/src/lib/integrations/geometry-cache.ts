/**
 * Route-geometry cache — SERVER ONLY. The fleet map draws 40-240 routes; without
 * caching that would re-hit the routing provider on every load. Geometry is
 * keyed by a hash of the ordered coordinates + active provider and stored in
 * route_geometry_cache (org-scoped). Misses are resolved once and upserted.
 */

import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRoutes, activeProvider, type LatLng } from "@/lib/routing";

function keyFor(points: LatLng[]): string {
  const provider = activeProvider();
  const coords = points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(";");
  return crypto.createHash("sha1").update(`${provider}|${coords}`).digest("hex");
}

export type ResolvedLeg = { geometry: LatLng[]; provider: string };

/**
 * Cached geometry + the provider that actually produced each leg. A cache hit
 * reports the provider stored when it was first resolved; a miss reports the
 * provider that just resolved it. "pcmiler" means the leg's geometry genuinely
 * came from PC*MILER — not merely that PC*MILER is configured.
 */
export async function resolveWithCacheDetailed(orgId: string, legs: LatLng[][]): Promise<ResolvedLeg[]> {
  if (legs.length === 0) return [];
  const admin = createAdminClient();
  const keys = legs.map(keyFor);

  // 1) load cached (geometry + provider)
  const { data: cachedRows } = await admin
    .from("route_geometry_cache")
    .select("cache_key, geometry, provider")
    .eq("org_id", orgId)
    .in("cache_key", Array.from(new Set(keys)));
  const cache = new Map<string, ResolvedLeg>();
  for (const row of cachedRows ?? []) {
    cache.set(row.cache_key as string, {
      geometry: row.geometry as LatLng[],
      provider: (row.provider as string) ?? "unknown",
    });
  }

  // 2) resolve misses (unique)
  const missIdx: number[] = [];
  const seenMiss = new Set<string>();
  legs.forEach((_, i) => {
    if (!cache.has(keys[i]) && !seenMiss.has(keys[i])) {
      seenMiss.add(keys[i]);
      missIdx.push(i);
    }
  });
  if (missIdx.length) {
    const resolved = await resolveRoutes(missIdx.map((i) => legs[i]));
    const upserts: { org_id: string; cache_key: string; provider: string; geometry: LatLng[] }[] = [];
    resolved.forEach((r, j) => {
      const i = missIdx[j];
      cache.set(keys[i], { geometry: r.geometry, provider: r.provider });
      upserts.push({ org_id: orgId, cache_key: keys[i], provider: r.provider, geometry: r.geometry });
    });
    if (upserts.length) {
      await admin.from("route_geometry_cache").upsert(upserts, { onConflict: "org_id,cache_key" });
    }
  }

  return legs.map((leg, i) => cache.get(keys[i]) ?? { geometry: leg, provider: "straight" });
}

export async function resolveWithCache(orgId: string, legs: LatLng[][]): Promise<LatLng[][]> {
  return (await resolveWithCacheDetailed(orgId, legs)).map((r) => r.geometry);
}
