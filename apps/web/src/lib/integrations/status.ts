/**
 * Integration connection status — SERVER ONLY. Reads env config to know whether
 * each system (DMSi, PC*MILER, EDI) is credentialed, merges with the last-sync
 * row from integration_status, and exposes what the /integrations page renders.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type SystemKey = "dmsi" | "pcmiler" | "edi";
// Systems that record sync state but aren't external credentialed connections.
export type SyncSystem = SystemKey | "automation";

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
    return {
      configured: c,
      live: c,
      detail: c
        ? "Connected with your access key."
        : "Waiting for your access key — maps still work using a free public routing service in the meantime.",
    };
  }
  if (system === "dmsi") {
    const c = !!process.env.DMSI_API_KEY && !!process.env.DMSI_BASE_URL;
    const live = process.env.DMSI_LIVE_MODE === "true";
    return {
      configured: c,
      live,
      detail: !c
        ? "Waiting for your access key — running in practice mode until it's connected."
        : live
          ? "LIVE — plans sent from here go straight to your real dispatch queue."
          : "Practice mode — plans are saved for review; nothing touches your live system.",
    };
  }
  // edi
  const c = !!process.env.EDI_SHARED_SECRET;
  return {
    configured: c,
    live: c,
    detail: c
      ? "Security key is set — only verified senders are accepted."
      : "Waiting for the shared security key — all incoming documents are rejected until it's set.",
  };
}

const LABELS: Record<SystemKey, string> = {
  dmsi: "DMSi Agility",
  pcmiler: "PC*MILER",
  edi: "Automatic Order Feed (EDI)",
};

// One-sentence plain-English description of what each system is.
export const SYSTEM_DESCRIPTIONS: Record<SystemKey, string> = {
  dmsi: "Your order management system — where all customer orders are entered and tracked.",
  pcmiler: "Your routing system — calculates the best road routes for your trucks.",
  edi: "A direct data line from trading partners — order documents arrive here automatically, no typing.",
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
  system: SyncSystem,
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
