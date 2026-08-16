"use client";

import dynamic from "next/dynamic";
import type { DemoRoute } from "@/components/demo-leaflet";

// Leaflet is browser-only — load the map layer client-side with no SSR.
const DemoLeaflet = dynamic(() => import("@/components/demo-leaflet"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-surface-2 text-sm text-ink-faint">
      Drawing routes…
    </div>
  ),
});

export type { DemoRoute };

export function DemoMap({
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
  return (
    <div className="h-[340px] overflow-hidden rounded-xl border border-[var(--border)]">
      <DemoLeaflet depot={depot} routes={routes} color={color} fitKey={fitKey} />
    </div>
  );
}
