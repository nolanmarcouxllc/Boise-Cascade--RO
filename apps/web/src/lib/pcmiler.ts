/**
 * PC*MILER Web Services (Trimble MapsAPI) REST client — SERVER ONLY.
 *
 * This is the same routing engine Boise Cascade dispatch runs, so the routes
 * rendered here match what Steve's team sees in PC*MILER.
 *
 * Auth: API key in the `Authorization` header (never in the client bundle).
 * Config: PCMILER_API_KEY, PCMILER_BASE_URL (see .env.local.example).
 * When PCMILER_API_KEY is empty every call returns null and the caller falls
 * back to OSRM — the map never breaks.
 *
 * Endpoints used (share this list with Steve's IT to grant/verify access):
 *   GET  {BASE}/route/routePath   — road geometry for an ordered stop list
 *   GET  {BASE}/route/routeReports?reports=Mileage — miles/hours for a route
 *   GET  {BASE}/locations?location=<addr>          — forward geocoding
 * Base (North America): https://pcmiler.alk.com/apis/rest/v1.0/Service.svc
 *
 * Vehicle profile: every request uses the 53-ft flatbed commercial profile
 * (see FLATBED_53) so restrictions, low clearances, and truck-legal roads are
 * honored exactly as production dispatch computes them.
 */

import "server-only";

export type LatLng = [number, number];

const BASE = () =>
  (process.env.PCMILER_BASE_URL || "https://pcmiler.alk.com/apis/rest/v1.0/Service.svc").replace(
    /\/$/,
    "",
  );
const KEY = () => process.env.PCMILER_API_KEY || "";

export function pcmilerConfigured(): boolean {
  return KEY().length > 0;
}

// 53-ft flatbed / 5-axle tractor-trailer. Dimensions in feet/lbs; PC*MILER
// applies the matching truck restrictions when routeType is truck-aware.
export const FLATBED_53 = {
  vehicleType: "Truck",
  vehLengthMeasured: "5300", // 53 ft trailer, hundredths of a foot? -> feet below
  length: "65", // ft, tractor + 53' trailer overall
  width: "102", // in
  height: "162", // in (13'6")
  weight: "80000", // lbs GVW (payload gate is enforced in the optimizer)
  axles: "5",
  lcv: "false",
  hazMat: "None",
  routeOptimization: "None",
} as const;

function commonParams(): Record<string, string> {
  return {
    region: "NA",
    dataVersion: "Current",
    routeType: "Practical", // truck-practical, matches dispatch
    vehicleType: FLATBED_53.vehicleType,
    truckCfg: "FiveAxle",
    length: FLATBED_53.length,
    width: FLATBED_53.width,
    height: FLATBED_53.height,
    weight: FLATBED_53.weight,
    axles: FLATBED_53.axles,
    hazMat: FLATBED_53.hazMat,
    overrideRestrict: "false",
  };
}

async function pcmilerGet(path: string, params: Record<string, string>): Promise<unknown | null> {
  if (!pcmilerConfigured()) return null;
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE()}${path}?${qs}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: KEY(), Accept: "application/json" },
      // route geometry is stable; let Next cache within a request lifecycle
      cache: "no-store",
    });
    if (!res.ok) {
      // Surface the real failure (auth, quota, blocked egress, bad params) in
      // the server logs instead of silently falling back to OSRM.
      const body = await res.text().catch(() => "");
      console.error(`[pcmiler] ${path} -> HTTP ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[pcmiler] ${path} request failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Road geometry following truck-legal roads for an ordered list of stops. */
export async function pcmilerRoutePath(points: LatLng[]): Promise<LatLng[] | null> {
  if (points.length < 2) return null;
  // PC*MILER stops are lng,lat pairs separated by ';'
  const stops = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const data = await pcmilerGet("/route/routePath", {
    ...commonParams(),
    stops,
    geometry: "true",
  });
  if (!data) return null;
  const line = extractLineString(data);
  return line && line.length >= 2 ? line : null;
}

/** Truck miles + drive hours for an ordered route (used for AFTER re-solve). */
export async function pcmilerMileage(
  points: LatLng[],
): Promise<{ miles: number; hours: number } | null> {
  if (points.length < 2) return null;
  const stops = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const data = (await pcmilerGet("/route/routeReports", {
    ...commonParams(),
    stops,
    reports: "Mileage",
  })) as { ReportLines?: { TMiles?: number; THours?: number }[] } | null;
  const last = data?.ReportLines?.[data.ReportLines.length - 1];
  if (!last || typeof last.TMiles !== "number") return null;
  return { miles: last.TMiles, hours: last.THours ?? 0 };
}

/** Forward geocode an address to lat/lng (used when a feed lacks coordinates). */
export async function pcmilerGeocode(address: string): Promise<LatLng | null> {
  const data = (await pcmilerGet("/locations", {
    region: "NA",
    dataVersion: "Current",
    location: address,
  })) as { Coords?: { Lat: string; Lon: string } }[] | null;
  const c = data?.[0]?.Coords;
  if (!c) return null;
  const lat = Number(c.Lat);
  const lng = Number(c.Lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

// PC*MILER returns a GeoJSON Feature whose geometry is usually a MultiLineString
// (coordinates = array of lines, each an array of [lng,lat] points); it can also
// be a plain LineString or a FeatureCollection. Handle all: flatten one level for
// MultiLineString, then convert [lng,lat] -> [lat,lng].
function extractLineString(data: unknown): LatLng[] | null {
  const obj = data as {
    features?: { geometry?: { coordinates?: unknown } }[];
    geometry?: { coordinates?: unknown };
    coordinates?: unknown;
  };
  const coords =
    obj?.features?.[0]?.geometry?.coordinates ??
    obj?.geometry?.coordinates ??
    obj?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;

  // MultiLineString: coordinates is [line][point][lng,lat] (depth 3). LineString:
  // [point][lng,lat] (depth 2). Detect by whether the innermost element nests.
  const isMultiLine = Array.isArray(coords[0]) && Array.isArray((coords[0] as unknown[])[0]);
  const points = (isMultiLine ? (coords as number[][][]).flat() : (coords as number[][]));

  const out = points
    .filter((c) => Array.isArray(c) && c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number")
    .map((c) => [c[1], c[0]] as LatLng);
  return out.length >= 2 ? out : null;
}
