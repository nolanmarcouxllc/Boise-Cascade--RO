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

export async function resolveWithCache(orgId: string, legs: LatLng[][]): Promise<LatLng[][]> {
  if (legs.length === 0) return [];
  const admin = createAdminClient();
  const keys = legs.map(keyFor);

  // 1) load cached
  const { data: cachedRows } = await admin
    .from("route_geometry_cache")
    .select("cache_key, geometry")
    .eq("org_id", orgId)
    .in("cache_key", Array.from(new Set(keys)));
  const cache = new Map<string, LatLng[]>();
  for (const row of cachedRows ?? []) cache.set(row.cache_key as string, row.geometry as LatLng[]);

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
      cache.set(keys[i], r.geometry);
      upserts.push({ org_id: orgId, cache_key: keys[i], provider: r.provider, geometry: r.geometry });
    });
    if (upserts.length) {
      await admin.from("route_geometry_cache").upsert(upserts, { onConflict: "org_id,cache_key" });
    }
  }

  return legs.map((leg, i) => cache.get(keys[i]) ?? leg);
}
