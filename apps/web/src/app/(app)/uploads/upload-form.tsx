"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Result = {
  uploadId: string;
  recordCount: number;
  warnings: string[];
};

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Upload failed.");
      setResult(body as Result);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel p-6">
      <div className="flex flex-wrap items-center gap-4">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="!w-auto !border-0 !bg-transparent !p-0 text-sm text-ink-muted file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
        />
        <button
          type="submit"
          disabled={!file || busy}
          className="btn btn-primary"
        >
          {busy ? "Uploading…" : "Upload this delivery file"}
        </button>
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        The spreadsheet should have columns for: delivery date, customer name,
        address, which truck made the delivery, and (if you have it) the load
        weight. Column names don&apos;t need to match exactly — we figure them out.
      </p>

      {error && (
        <p className="mt-4 rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-good/30 bg-good/10 px-4 py-3 text-sm text-good">
          <p className="font-medium">
            Got it — {result.recordCount} deliveries read from your file.
          </p>
          {result.warnings.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-good/80">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <Link
            href="/analyze"
            className="mt-2 inline-block font-medium text-good underline underline-offset-2"
          >
            Now find the wasted trips in it →
          </Link>
        </div>
      )}
    </form>
  );
}
