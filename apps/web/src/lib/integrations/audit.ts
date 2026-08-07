/**
 * Integration audit log — SERVER ONLY. Every integration event (DMSi pull/push,
 * EDI receipt, rejected webhook, optimizer run) writes one row here so Steve's
 * IT team has a complete paper trail. Uses the service role so a failure or a
 * rejected/unauthenticated request can still be recorded.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuditEntry = {
  orgId: string;
  sourceSystem: "dmsi" | "pcmiler" | "edi" | "optimizer" | "csv";
  eventType: string;
  direction?: "inbound" | "outbound";
  status: "success" | "failure" | "rejected";
  recordCount?: number;
  message?: string;
  payload?: unknown;
  sourceIp?: string | null;
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("integration_audit_log").insert({
      org_id: entry.orgId,
      source_system: entry.sourceSystem,
      event_type: entry.eventType,
      direction: entry.direction ?? "inbound",
      status: entry.status,
      record_count: entry.recordCount ?? 0,
      message: entry.message ?? null,
      payload: entry.payload ?? null,
      source_ip: entry.sourceIp ?? null,
    });
  } catch {
    // Never let audit logging break the request path; the console is the
    // last-resort sink (structured, no secrets — callers must not pass keys).
    console.error("[audit] failed to write entry", entry.sourceSystem, entry.eventType);
  }
}
