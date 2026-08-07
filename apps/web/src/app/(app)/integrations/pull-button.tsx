"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DmsiPullButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pull() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/dmsi/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Pull failed");
      setMsg(
        body.mocked
          ? "Mocked — DMSi not configured yet (wiring verified)"
          : `Pulled ${body.records} order(s)`,
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Pull failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <button onClick={pull} disabled={busy} className="btn btn-ghost w-full text-xs">
        {busy ? "Pulling…" : "Pull today's orders"}
      </button>
      {msg && <p className="mt-2 text-xs text-ink-muted">{msg}</p>}
    </div>
  );
}
