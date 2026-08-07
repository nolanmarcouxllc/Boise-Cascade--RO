/**
 * Unified route-geometry resolver — SERVER ONLY.
 * Prefers PC*MILER (production dispatch engine, 53-ft flatbed profile); falls
 * back to OSRM when PC*MILER isn't configured or a call fails, and to a straight
 * line only as a last resort so the map never breaks. All route rendering in the
 * app goes through here.
 */

import "server-only";
import { pcmilerRoutePath, pcmilerConfigured, type LatLng } from "@/lib/pcmiler";
import { fetchRoadRoute } from "@/lib/osrm";

export type { LatLng };
export type RouteProvider = "pcmiler" | "osrm" | "straight";

export type ResolvedRoute = {
  geometry: LatLng[];
  provider: RouteProvider;
};

export function activeProvider(): "pcmiler" | "osrm" {
  return pcmilerConfigured() ? "pcmiler" : "osrm";
}

export async function resolveRoute(points: LatLng[]): Promise<ResolvedRoute> {
  if (points.length < 2) {
    return { geometry: points, provider: "straight" };
  }
  if (pcmilerConfigured()) {
    const pc = await pcmilerRoutePath(points);
    if (pc && pc.length >= 2) return { geometry: pc, provider: "pcmiler" };
  }
  const osrm = await fetchRoadRoute(points);
  if (osrm && osrm.length >= 2) return { geometry: osrm, provider: "osrm" };
  return { geometry: points, provider: "straight" };
}

export async function resolveRoutes(legs: LatLng[][]): Promise<ResolvedRoute[]> {
  // Bounded concurrency so a fleet map (100+ legs) doesn't hammer the provider.
  const out: ResolvedRoute[] = new Array(legs.length);
  const LIMIT = 6;
  let i = 0;
  async function worker() {
    while (i < legs.length) {
      const idx = i++;
      out[idx] = await resolveRoute(legs[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, legs.length) }, worker));
  return out;
}
