"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money } from "@/lib/format";
import type { RunTotals } from "@/lib/types";

type Option = { id: string; label: string; date: string; records: number; checkable: boolean };
type Phase = "idle" | "running" | "completed" | "failed";

const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 120; // ~2 minutes

export function AnalyzePanel({ options }: { options: Option[] }) {
  const router = useRouter();
  const [uploadId, setUploadId] = useState(
    (options.find((o) => o.checkable) ?? options[0])?.id ?? "",
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [totals, setTotals] = useState<RunTotals | null>(null);

  async function start() {
    if (!uploadId) return;
    setPhase("running");
    setError(null);
    setTotals(null);
    setRunId(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not start analysis.");
      setRunId(body.runId);
      await poll(body.runId);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Analysis failed.");
    }
  }

  async function poll(id: string) {
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      if (!res.ok) continue;
      const body = await res.json();
      if (body.status === "completed") {
        setTotals(body.totals as RunTotals);
        setPhase("completed");
        router.refresh();
        return;
      }
      if (body.status === "failed") {
        setPhase("failed");
        setError(body.error ?? "The analysis run failed.");
        return;
      }
    }
    setPhase("failed");
    setError("Timed out waiting for the run to finish.");
  }

  if (options.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-ink-muted">
        Upload a spreadsheet of your deliveries first.{" "}
        <Link href="/uploads" className="font-medium text-brand-700">
          Upload delivery data →
        </Link>
      </div>
    );
  }

  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block flex-1">
          <span className="mb-1 block text-sm font-medium text-ink-muted">
            Which set of deliveries to check
          </span>
          <select
            value={uploadId}
            onChange={(e) => setUploadId(e.target.value)}
            disabled={phase === "running"}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id} disabled={!o.checkable}>
                {o.label} — {o.records} deliveries · {o.date}
                {o.checkable ? "" : " (waiting for dispatch — nothing to check yet)"}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={start}
          disabled={phase === "running" || !uploadId || !options.find((o) => o.id === uploadId)?.checkable}
          className="btn btn-primary px-5"
        >
          {phase === "running"
            ? "Checking…"
            : "Find duplicate and overlapping deliveries in this data"}
        </button>
      </div>

      {phase === "running" && (
        <div className="mt-5 flex items-center gap-3 text-sm text-ink-muted">
          <Spinner />
          <span>
            Looking through every delivery for trucks that doubled up, and
            adding up what it cost…
          </span>
        </div>
      )}

      {phase === "failed" && error && (
        <p className="mt-5 rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
          {error}
        </p>
      )}

      {phase === "completed" && totals && (
        <div className="mt-5 rounded-xl border border-good/30 bg-good/10 p-4">
          <div className="text-sm text-good">
            Done — found{" "}
            <span className="font-semibold">{totals.candidate_groups}</span>{" "}
            case(s) where deliveries should have shared a truck, costing you{" "}
            <span className="font-semibold">
              {money(totals.cost_internal)}
            </span>{" "}
            in unnecessary trips.
          </div>
          <Link
            href={runId ? `/dashboard?run=${runId}` : "/dashboard"}
            className="mt-2 inline-block text-sm font-medium text-good underline underline-offset-2"
          >
            See the full story on the map →
          </Link>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
