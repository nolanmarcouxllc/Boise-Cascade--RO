// Side-by-side "what happened" vs "what consolidation does" for one finding.
// Before: N trucks each drove a separate round trip from the yard to the same
// place. After: one truck covers it. Pure SVG schematic (no map library), using
// the real bearing from depot to the stop so each finding looks distinct.

import { money, num } from "@/lib/format";
import type { ConsolidationFinding } from "@/lib/types";

const ALERT = "#e6194b";
const GOOD = "#0a8a43";
const INK = "#0f172a";
const MUTED = "#8a94a6";
const GRID = "#e6ebf2";

const W = 220;
const H = 150;

type Depot = { name: string; lat: number; lng: number };

export function RouteCompare({
  finding,
  depot,
}: {
  finding: ConsolidationFinding;
  depot: Depot;
}) {
  const plan = finding.consolidated_plan_json;
  const trucks =
    plan?.distinct_trucks ?? (finding.duplicate_trucks ?? 0) + 1;
  const [clat, clng] = plan?.centroid ?? [depot.lat, depot.lng];

  // Project depot (fixed center) and the stop (offset along the real bearing).
  const depotPt: [number, number] = [W / 2 - 12, H / 2 + 8];
  const dLng = clng - depot.lng;
  const dLat = clat - depot.lat;
  const mag = Math.hypot(dLng, dLat) || 1;
  const R = 58;
  const stopPt: [number, number] = [
    depotPt[0] + (dLng / mag) * R,
    depotPt[1] - (dLat / mag) * R, // screen y is inverted vs latitude
  ];

  const name = finding.customer_name ?? "cluster";
  const shortName = name.length > 16 ? name.slice(0, 15) + "…" : name;

  return (
    <div className="panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium text-ink">{name}</div>
        <div className="text-sm text-ink-muted">
          {finding.date} ·{" "}
          <span className="font-semibold text-good">
            {money(finding.est_cost_usd)}
          </span>{" "}
          recoverable
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel
          heading="Before — what happened"
          tone="alert"
          caption={`${trucks} trucks made separate trips to the same place`}
          metric={`${num(finding.wasted_miles)} wasted miles`}
        >
          <Diagram
            depotPt={depotPt}
            stopPt={stopPt}
            routes={trucks}
            color={ALERT}
            stopLabel={shortName}
          />
        </Panel>

        <Panel
          heading="After — consolidated"
          tone="good"
          caption="One truck covers the stop"
          metric="0 wasted miles"
        >
          <Diagram
            depotPt={depotPt}
            stopPt={stopPt}
            routes={1}
            color={GOOD}
            stopLabel={shortName}
          />
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  heading,
  tone,
  caption,
  metric,
  children,
}: {
  heading: string;
  tone: "alert" | "good";
  caption: string;
  metric: string;
  children: React.ReactNode;
}) {
  const toneClass = tone === "alert" ? "text-alert" : "text-good";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-2 p-3">
      <div className={`mb-1 text-xs font-semibold uppercase tracking-wide ${toneClass}`}>
        {heading}
      </div>
      <div className="overflow-hidden rounded-lg bg-white">{children}</div>
      <div className="mt-2 text-sm text-ink">{caption}</div>
      <div className={`text-sm font-semibold ${toneClass}`}>{metric}</div>
    </div>
  );
}

function Diagram({
  depotPt,
  stopPt,
  routes,
  color,
  stopLabel,
}: {
  depotPt: [number, number];
  stopPt: [number, number];
  routes: number;
  color: string;
  stopLabel: string;
}) {
  const [dx, dy] = depotPt;
  const [sx, sy] = stopPt;

  // Perpendicular unit vector, to fan multiple routes apart.
  const len = Math.hypot(sx - dx, sy - dy) || 1;
  const px = -(sy - dy) / len;
  const py = (sx - dx) / len;
  const spread = 16;

  const paths: string[] = [];
  for (let k = 0; k < routes; k++) {
    const offset = (k - (routes - 1) / 2) * spread;
    const mx = (dx + sx) / 2 + px * offset;
    const my = (dy + sy) / 2 + py * offset;
    paths.push(`M ${dx} ${dy} Q ${mx} ${my} ${sx} ${sy}`);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 H0 V20" fill="none" stroke={GRID} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeOpacity={0.85}
          strokeLinecap="round"
        />
      ))}

      {/* stop */}
      <circle cx={sx} cy={sy} r={7} fill={color} />
      <circle cx={sx} cy={sy} r={7} fill="none" stroke="#fff" strokeWidth={2} />
      <text
        x={sx}
        y={sy - 12}
        textAnchor="middle"
        fontSize="9"
        fill={INK}
        fontWeight="600"
      >
        {stopLabel}
      </text>

      {/* depot */}
      <rect
        x={dx - 7}
        y={dy - 7}
        width={14}
        height={14}
        rx={2}
        fill={INK}
      />
      <text x={dx} y={dy + 22} textAnchor="middle" fontSize="9" fill={MUTED}>
        Yard
      </text>
    </svg>
  );
}
