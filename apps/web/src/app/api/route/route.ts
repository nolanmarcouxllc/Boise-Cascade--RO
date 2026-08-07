import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api-auth";
import { resolveRoutes, activeProvider, type LatLng } from "@/lib/routing";

export const runtime = "nodejs";

// Resolve road geometry for one or more legs. Body: { legs: LatLng[][] } where
// each leg is an ordered list of [lat,lng] stops. Returns geometry + which
// provider drew it (pcmiler | osrm | straight). Auth-gated.
export async function POST(request: Request) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;

  let legs: LatLng[][] = [];
  try {
    const body = await request.json();
    legs = Array.isArray(body?.legs) ? body.legs : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate shape: array of arrays of [number, number].
  const valid = legs.every(
    (leg) =>
      Array.isArray(leg) &&
      leg.length >= 2 &&
      leg.every(
        (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)),
      ),
  );
  if (!valid) {
    return NextResponse.json({ error: "legs must be arrays of >=2 [lat,lng] points" }, { status: 400 });
  }
  if (legs.length > 200) {
    return NextResponse.json({ error: "too many legs (max 200)" }, { status: 400 });
  }

  const resolved = await resolveRoutes(legs);
  return NextResponse.json({
    provider: activeProvider(),
    routes: resolved.map((r) => ({ geometry: r.geometry, provider: r.provider })),
  });
}
