/**
 * Integration connection status — SERVER ONLY. Reads env config to know whether
 * each system (DMSi, PC*MILER, EDI) is credentialed, merges with the last-sync
 * row from integration_status, and exposes what the /integrations page renders.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type SystemKey = "dmsi" | "pcmiler" | "edi";

export type SystemStatus = {
  system: SystemKey;
  label: string;
  configured: boolean; // credentials present in env
  liveMode: boolean; // DMSi only: DMSI_LIVE_MODE
  connected: boolean; // configured AND a successful sync recorded
  lastSyncAt: string | null;
  lastRecordCount: number;
  detail: string;
};

function envConfigured(system: SystemKey): { configured: boolean; live: boolean; detail: string } {
  if (system === "pcmiler") {
    const c = !!process.env.PCMILER_API_KEY;
    return { configured: c, live: c, detail: c ? "API key present" : "No API key — using OSRM fallback" };
  }
  if (system === "dmsi") {
    const c = !!process.env.DMSI_API_KEY && !!process.env.DMSI_BASE_URL;
    const live = process.env.DMSI_LIVE_MODE === "true";
    return {
      configured: c,
      live,
      detail: !c
        ? "No API key/URL — calls mocked + logged"
        : live
          ? "Live mode — writes hit production DMSi"
          : "Simulation mode — payloads logged, not sent",
    };
  }
  // edi
  const c = !!process.env.EDI_SHARED_SECRET;
  return { configured: c, live: c, detail: c ? "Shared secret set — HMAC enforced" : "No shared secret — webhook rejects all" };
}

const LABELS: Record<SystemKey, string> = {
  dmsi: "DMSi Agility API",
  pcmiler: "PC*MILER API",
  edi: "EDI Webhook (Kleinschmidt)",
};

export async function getIntegrationStatus(orgId: string): Promise<SystemStatus[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_status")
    .select("system, last_sync_at, last_record_count, connected")
    .eq("org_id", orgId);
  const bysystem = new Map((data ?? []).map((r) => [r.system as SystemKey, r]));

  return (["dmsi", "pcmiler", "edi"] as SystemKey[]).map((system) => {
    const env = envConfigured(system);
    const row = bysystem.get(system);
    return {
      system,
      label: LABELS[system],
      configured: env.configured,
      liveMode: env.live,
      connected: env.configured && !!row?.connected,
      lastSyncAt: (row?.last_sync_at as string) ?? null,
      lastRecordCount: (row?.last_record_count as number) ?? 0,
      detail: env.detail,
    };
  });
}

export async function recordSync(
  orgId: string,
  system: SystemKey,
  recordCount: number,
  detail?: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("integration_status")
    .upsert(
      {
        org_id: orgId,
        system,
        connected: true,
        last_sync_at: new Date().toISOString(),
        last_record_count: recordCount,
        detail: detail ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,system" },
    );
}
