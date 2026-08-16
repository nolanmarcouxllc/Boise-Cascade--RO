"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = "&copy; OpenStreetMap &copy; CARTO";

export type DemoRoute = {
  truckId: string;
  geometry: [number, number][];
  stops: { lat: number; lng: number; customer: string; isNew?: boolean }[];
};

const NEW_STOP = "#7c3aed"; // violet — the just-uploaded order, stands out from red/green fleets

// Draw one fleet (all routes one color) on the pale Positron basemap — matches
// the main app's map styling so the two demo columns read as the same system.
export default function DemoLeaflet({
  depot,
  routes,
  color,
  fitKey,
}: {
  depot: { lat: number; lng: number; name: string };
  routes: DemoRoute[];
  color: string;
  fitKey: string;
}) {
  const depotPos: [number, number] = [depot.lat, depot.lng];

  const depotIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;background:#0f172a;border:2px solid #fff;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    [],
  );

  return (
    <MapContainer center={depotPos} zoom={9} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" maxZoom={19} />
      <FitBounds routes={routes} depot={depotPos} fitKey={fitKey} />

      {routes.map((r, i) => (
        <Polyline
          key={`${r.truckId}:${i}`}
          positions={r.geometry}
          pathOptions={{ color, weight: 2.5, opacity: 0.75 }}
        >
          <Tooltip sticky>
            Truck {r.truckId} — {r.stops.length} stop{r.stops.length === 1 ? "" : "s"}
          </Tooltip>
        </Polyline>
      ))}

      {routes.map((r, i) =>
        r.stops.map((s, j) =>
          s.isNew ? (
            // The uploaded order — larger violet marker with a halo so the room
            // can see exactly where it landed on each side.
            <CircleMarker
              key={`${r.truckId}:${i}:${j}`}
              center={[s.lat, s.lng]}
              radius={8}
              pathOptions={{ color: "#fff", fillColor: NEW_STOP, fillOpacity: 1, weight: 3 }}
              className="pulse-dot"
            >
              <Tooltip permanent direction="top" offset={[0, -8]}>
                New order: {s.customer}
              </Tooltip>
            </CircleMarker>
          ) : (
            <CircleMarker
              key={`${r.truckId}:${i}:${j}`}
              center={[s.lat, s.lng]}
              radius={3.5}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 1 }}
            >
              <Tooltip>{s.customer}</Tooltip>
            </CircleMarker>
          ),
        ),
      )}

      <Marker position={depotPos} icon={depotIcon}>
        <Tooltip>{depot.name} — home base</Tooltip>
      </Marker>
    </MapContainer>
  );
}

function FitBounds({
  routes,
  depot,
  fitKey,
}: {
  routes: DemoRoute[];
  depot: [number, number];
  fitKey: string;
}) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [depot];
    for (const r of routes) for (const g of r.geometry) pts.push(g);
    if (pts.length < 2) {
      map.setView(depot, 9);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}
