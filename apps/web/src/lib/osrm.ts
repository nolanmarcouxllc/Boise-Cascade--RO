// Road-following route geometry from the public OSRM service. Runs in the
// browser. Returns the driving polyline as [lat, lng] points, or null if the
// service is unreachable (caller falls back to a straight line).

export type LatLng = [number, number];

export async function fetchRoadRoute(points: LatLng[]): Promise<LatLng[] | null> {
  if (points.length < 2) return null;
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const line = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(line)) return null;
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    return line.map((c: number[]) => [c[1], c[0]] as LatLng);
  } catch {
    return null;
  }
}
