// Browser helper: resolve road geometry via the server /api/route endpoint
// (which uses PC*MILER when configured, else OSRM). Keeps routing keys server-
// side. Returns one geometry per input leg; falls back to the raw leg (straight)
// if the request fails so the map never breaks.

export type LatLng = [number, number];

export async function fetchRoutes(legs: LatLng[][]): Promise<LatLng[][]> {
  if (legs.length === 0) return [];
  try {
    const res = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legs }),
    });
    if (!res.ok) return legs;
    const body = await res.json();
    const routes = body?.routes;
    if (!Array.isArray(routes)) return legs;
    return legs.map((leg, i) => {
      const g = routes[i]?.geometry;
      return Array.isArray(g) && g.length >= 2 ? (g as LatLng[]) : leg;
    });
  } catch {
    return legs;
  }
}
