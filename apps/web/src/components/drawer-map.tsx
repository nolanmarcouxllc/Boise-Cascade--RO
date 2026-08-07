"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type DrawerRoute = { geometry: [number, number][]; color: string };
export type DrawerStop = { lat: number; lng: number; color: string; label: string };

// Small read-only map for the finding detail drawer (BEFORE / AFTER).
export default function DrawerMap({
  depot,
  routes,
  stops,
  height = 220,
}: {
  depot: { lat: number; lng: number };
  routes: DrawerRoute[];
  stops: DrawerStop[];
  height?: number;
}) {
  const depotPos: [number, number] = [depot.lat, depot.lng];
  return (
    <div style={{ height }} className="overflow-hidden rounded-lg">
      <MapContainer center={depotPos} zoom={8} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="&copy; OSM &copy; CARTO" subdomains="abcd" />
        {routes.map((r, i) => (
          <Polyline key={i} positions={r.geometry} pathOptions={{ color: r.color, weight: 3, opacity: 0.9 }} />
        ))}
        <CircleMarker center={depotPos} radius={5} pathOptions={{ color: "#0f172a", fillColor: "#0f172a", fillOpacity: 1 }} />
        {stops.map((s, i) => (
          <CircleMarker key={i} center={[s.lat, s.lng]} radius={5} pathOptions={{ color: s.color, fillColor: s.color, fillOpacity: 0.9 }} />
        ))}
        <Fit depot={depotPos} routes={routes} />
      </MapContainer>
    </div>
  );
}

function Fit({ depot, routes }: { depot: [number, number]; routes: DrawerRoute[] }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [depot];
    for (const r of routes) for (const g of r.geometry) pts.push(g);
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
  }, [depot, routes, map]);
  return null;
}
