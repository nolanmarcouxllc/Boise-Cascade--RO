"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type LatLng = [number, number];

export type StopMarker = {
  pos: LatLng;
  label: string;
  sub?: string;
};

type Props = {
  depot: { pos: LatLng; name: string };
  stops: StopMarker[];
  routes: LatLng[][];
  color: string;
  height?: number;
};

// CartoDB Positron — the same pale basemap the original folium map used.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  // Serialize points so the effect only re-runs when the coordinates change,
  // not on every re-render (which would fight the user's zoom/pan).
  const key = points.map((p) => p.join(",")).join(";");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export default function LaneMap({ depot, stops, routes, color, height = 340 }: Props) {
  const depotIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;background:#0f172a;border:2px solid #fff;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    [],
  );

  const stopIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:15px;height:15px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
        iconSize: [15, 15],
        iconAnchor: [7.5, 7.5],
      }),
    [color],
  );

  const allPoints = useMemo(
    () => [depot.pos, ...stops.map((s) => s.pos), ...routes.flat()],
    [depot.pos, stops, routes],
  );

  return (
    <div style={{ height }} className="overflow-hidden rounded-lg">
      <MapContainer
        center={depot.pos}
        zoom={7}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" maxZoom={19} />
        {routes.map((r, i) => (
          <Polyline
            key={i}
            positions={r}
            pathOptions={{ color, weight: 4, opacity: 0.85 }}
          />
        ))}
        <Marker position={depot.pos} icon={depotIcon}>
          <Popup>
            <strong>{depot.name}</strong>
            <br />
            Distribution yard
          </Popup>
        </Marker>
        {stops.map((s, i) => (
          <Marker key={i} position={s.pos} icon={stopIcon}>
            <Popup>
              <strong>{s.label}</strong>
              {s.sub ? (
                <>
                  <br />
                  {s.sub}
                </>
              ) : null}
            </Popup>
          </Marker>
        ))}
        <FitBounds points={allPoints} />
      </MapContainer>
    </div>
  );
}
