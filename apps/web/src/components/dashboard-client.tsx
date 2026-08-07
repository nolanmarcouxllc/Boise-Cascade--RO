"use client";

import { useCallback, useMemo, useState } from "react";
import { FleetMap, type FleetHighlight } from "@/components/fleet-map";
import { FindingsPanel } from "@/components/findings-panel";
import { FindingPanel } from "@/components/finding-drawer";
import { PlanBanner, type PlanBannerData } from "@/components/plan-banner";
import { PlanEditor } from "@/components/plan-editor";
import type { ConsolidationFinding } from "@/lib/types";

// Ties every entry point to one consistent detail panel: selecting a finding —
// from the table, a route line, or a stop marker — highlights its lane on the
// map and opens the same full slide-in panel on the right.
export function DashboardClient({
  findings,
  initialDate,
  banner,
}: {
  findings: ConsolidationFinding[];
  initialDate?: string;
  banner?: PlanBannerData | null;
}) {
  const [selected, setSelected] = useState<ConsolidationFinding | null>(null);
  const [editingPlan, setEditingPlan] = useState<string | null>(null);

  // Map every delivery-record id to its finding (via the finding's order_ids),
  // so a click on any stop or route resolves to the right finding regardless of
  // how group ids are formatted across the Python and TS engines.
  const byRecord = useMemo(() => {
    const m = new Map<string, ConsolidationFinding>();
    for (const f of findings) {
      for (const oid of f.consolidated_plan_json?.order_ids ?? []) m.set(oid, f);
    }
    return m;
  }, [findings]);

  const openByRecord = useCallback(
    (recordId: string) => {
      const f = byRecord.get(recordId);
      if (f) setSelected(f);
    },
    [byRecord],
  );

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
      {banner && <PlanBanner data={banner} onReview={() => setEditingPlan(banner.planId)} />}
      <FleetMap initialDate={initialDate} highlight={highlight} onOpenFinding={openByRecord} />
      <FindingsPanel findings={findings} selectedId={selected?.id ?? null} onSelect={setSelected} />
      <FindingPanel findingId={selected?.id ?? null} onClose={() => setSelected(null)} />
      {editingPlan && <PlanEditor planId={editingPlan} onClose={() => setEditingPlan(null)} />}
    </div>
  );
}
