"use client";

import { useState } from "react";
import { money } from "@/lib/format";

export type PlanBannerData = {
  planId: string;
  loads: number;
  trucks: number;
  trucksBefore: number;
  recoverable: number;
  pushedAt: string | null; // ISO
  pushMode: string | null; // simulation | live
};

// "New optimized dispatch plan ready" notification. Appears when the
// automation pipeline has produced + pushed a plan; dismissable per session.
export function PlanBanner({ data, onReview }: { data: PlanBannerData; onReview?: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const pushed = data.pushedAt
    ? new Date(data.pushedAt)
        .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        .toLowerCase()
        .replace(" ", "")
    : null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-good/40 bg-good/10 px-4 py-3">
      <span className="inline-block h-2.5 w-2.5 flex-shrink-0 animate-pulse rounded-full bg-good" />
      <p className="flex-1 text-sm text-ink">
        <span className="font-semibold">New optimized dispatch plan ready</span> —{" "}
        {data.loads} loads, {data.trucks} trucks (blind dispatch would use {data.trucksBefore}),{" "}
        <span className="font-semibold text-good">{money(data.recoverable)}</span> recoverable.
        {pushed && (
          <span className="text-ink-muted">
            {" "}Pushed to DMSi at {pushed}
            {data.pushMode === "simulation" ? " (simulation)" : ""}.
          </span>
        )}
      </p>
      {onReview && (
        <button onClick={onReview} className="btn btn-primary !py-1.5 text-xs">
          Review &amp; edit plan
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="text-ink-faint hover:text-ink"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
