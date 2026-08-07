"use client";

import { useMemo, useState } from "react";
import { FleetMap, type FleetHighlight } from "@/components/fleet-map";
import { FindingsPanel } from "@/components/findings-panel";
import type { ConsolidationFinding } from "@/lib/types";

// Ties the fleet map (Section 2) and the findings table + drawer (Section 3)
// together: selecting a finding highlights its lane on the map above and opens
// its detail drawer below.
export function DashboardClient({
  findings,
  initialDate,
}: {
  findings: ConsolidationFinding[];
  initialDate?: string;
}) {
  const [selected, setSelected] = useState<ConsolidationFinding | null>(null);

  const highlight: FleetHighlight = useMemo(() => {
    if (!selected || !selected.date) return null;
    return {
      date: selected.date,
      truckIds: selected.consolidated_plan_json?.truck_ids ?? [],
      groupId: selected.consolidated_plan_json?.group_id,
    };
  }, [selected]);

  return (
    <div className="space-y-8">
      <FleetMap initialDate={initialDate} highlight={highlight} />
      <FindingsPanel findings={findings} selectedId={selected?.id ?? null} onSelect={setSelected} />
    </div>
  );
}
