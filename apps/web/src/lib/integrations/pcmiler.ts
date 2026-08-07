/**
 * PC*MILER integration façade — SERVER ONLY.
 *
 * The canonical PC*MILER REST client lives in src/lib/pcmiler.ts (built in
 * Step 1 for map routing). To avoid two clients, this module re-exports that
 * one's commercial-vehicle functions as the integration surface: routing,
 * mileage, and geocoding, all on the 53-ft flatbed profile.
 */

import "server-only";
export {
  pcmilerRoutePath,
  pcmilerMileage,
  pcmilerGeocode,
  pcmilerConfigured,
  FLATBED_53,
  type LatLng,
} from "@/lib/pcmiler";
