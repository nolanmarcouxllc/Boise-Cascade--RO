/**
 * Server-side guard for internal /api routes. Every internal route calls
 * requireOrg(request) which enforces, in order: per-IP rate limiting, an
 * authenticated user, and org membership. Data-isolation checks on specific
 * resources are done in the route (assertOrg).
 */

import "server-only";
import { NextResponse } from "next/server";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { clientIp } from "@/lib/integrations/net";
import { writeAudit } from "@/lib/integrations/audit";

export type Guard =
  | { ok: true; ctx: SessionContext & { org: NonNullable<SessionContext["org"]> } }
  | { ok: false; response: NextResponse };

/** Rate-limit by IP, then require an authenticated user that belongs to an org. */
export async function requireOrg(request?: Request): Promise<Guard> {
  if (request) {
    const rl = checkRateLimit(`api:${clientIp(request)}`, { windowMs: 60_000, max: 120, hardBlock: 400 });
    if (!rl.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Too Many Requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }),
      };
    }
  }
  const ctx = await getSessionContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!ctx.org) {
    return { ok: false, response: NextResponse.json({ error: "No organization" }, { status: 403 }) };
  }
  return { ok: true, ctx: { ...ctx, org: ctx.org } };
}

/**
 * Data-isolation check: the resource's org_id must match the caller's org.
 * Returns a 403 (and logs) on mismatch — a second layer above DB RLS.
 */
export async function assertOrg(
  resourceOrgId: string | null | undefined,
  callerOrgId: string,
): Promise<NextResponse | null> {
  if (resourceOrgId && resourceOrgId !== callerOrgId) {
    await writeAudit({
      orgId: callerOrgId,
      sourceSystem: "optimizer",
      eventType: "org_isolation_violation",
      status: "rejected",
      message: `Attempted cross-org access to resource owned by ${resourceOrgId}`,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
