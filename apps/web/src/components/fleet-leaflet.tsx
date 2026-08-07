"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteView } from "@/components/fleet-map";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';

const BLUE = "#2563eb"; // clean, well-loaded
const AMBER = "#f58231"; // suboptimal (open capacity)
const RED = "#e6194b"; // waste candidate

export function routeColor(r: RouteView): string {
  if (r.hasCandidate) return RED;
  if (r.remainingCapacity > 18000) return AMBER;
  return BLUE;
}
function routeOpacity(r: RouteView): number {
  return Math.max(0.3, Math.min(0.9, 0.3 + 0.6 * (r.totalWeight / 48000)));
}

export default function FleetLeaflet({
  depot,
  routes,
  selectedKey,
  onSelectRoute,
  onOpenFinding,
  fitKey,
  emphasize,
}: {
  depot: { lat: number; lng: number; name: string };
  routes: RouteView[];
  selectedKey: string | null;
  onSelectRoute: (key: string) => void;
  onOpenFinding?: (groupId: string) => void;
  fitKey: string;
  emphasize?: Set<string>;
}) {
  const depotPos: [number, number] = [depot.lat, depot.lng];

  const depotIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;background:#0f172a;border:2px solid #fff;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    [],
  );

  // Stops belonging to the selected route get visible markers; candidate stops
  // are always shown (pulsing) so the problem is visible without filtering.
  const selected = routes.find((r) => r.key === selectedKey) ?? null;

  return (
    <MapContainer center={depotPos} zoom={8} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" maxZoom={19} />
      <FitBounds routes={routes} depot={depotPos} fitKey={fitKey} />

      {routes.map((r) => {
        const isSel = r.key === selectedKey;
        const isEmph = emphasize?.has(r.truckId) ?? false;
        // Whole line is the click target: candidates thickest (8px) so the
        // waste is the easiest thing on the map to hit; everything >= 6px.
        const baseWeight = isSel || isEmph ? 10 : r.hasCandidate ? 8 : 6;
        const baseOpacity = isSel || isEmph ? 1 : routeOpacity(r);
        return (
          <Polyline
            key={r.key}
            positions={r.geometry}
            pathOptions={{
              color: routeColor(r),
              weight: baseWeight,
              opacity: baseOpacity,
              className: r.hasCandidate ? "pulse-route" : undefined,
            }}
            eventHandlers={{
              click: () => {
                const cand = r.stops.find((s) => s.isCandidate);
                if (r.hasCandidate && cand && onOpenFinding) onOpenFinding(cand.id);
                else onSelectRoute(r.key);
              },
              // Hover affordance: brighten + thicken so it reads as clickable
              // before the click (Leaflet already sets cursor: pointer).
              mouseover: (e) => e.target.setStyle({ weight: baseWeight + 2, opacity: 1 }),
              mouseout: (e) => e.target.setStyle({ weight: baseWeight, opacity: baseOpacity }),
            }}
          />
        );
      })}

      {/* candidate stops (always) + selected route stops */}
      {routes.map((r) =>
        r.stops.map((s) => {
          const showAsMarker = r.key === selectedKey;
          if (!s.isCandidate && !showAsMarker) return null;
          const color = s.isCandidate ? RED : routeColor(r);
          const openable = s.isCandidate && onOpenFinding;
          return (
            <CircleMarker
              key={`${r.key}:${s.id}`}
              center={[s.lat, s.lng]}
              radius={showAsMarker ? 6 : 4}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 1.5 }}
              className={s.isCandidate ? "pulse-dot" : undefined}
              eventHandlers={openable ? { click: () => onOpenFinding!(s.id) } : undefined}
            >
              <Popup>
                <strong>{s.customer}</strong>
                <br />
                {s.address ?? ""}
                <br />
                Truck {s.truckId} · {s.window ?? "—"} · {Math.round(s.weight).toLocaleString()} lb
                {s.orderNumber ? <><br />Order {s.orderNumber}</> : null}
                {s.isCandidate ? (
                  <>
                    <br />
                    <span style={{ color: RED, fontWeight: 600 }}>
                      Consolidation candidate ({s.candidateType === "geo_cluster" ? "same area" : "same customer"})
                    </span>
                    <br />
                    Click the marker for the full breakdown →
                  </>
                ) : null}
              </Popup>
            </CircleMarker>
          );
        }),
      )}

      <Marker position={depotPos} icon={depotIcon}>
        <Popup>
          <strong>{depot.name}</strong>
          <br />
          Distribution yard
        </Popup>
      </Marker>

      {selected ? null : null}
    </MapContainer>
  );
}

function FitBounds({
  routes,
  depot,
  fitKey,
}: {
  routes: RouteView[];
  depot: [number, number];
  fitKey: string;
}) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [depot];
    for (const r of routes) for (const g of r.geometry) pts.push(g);
    if (pts.length < 2) {
      map.setView(depot, 8);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}
