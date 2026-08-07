/**
 * Server-side auth guard for internal /api routes. Every internal route calls
 * requireSession() (or requireOrg()) before doing anything. Step-8 security adds
 * rate limiting and org-resource checks on top of this.
 */

import "server-only";
import { NextResponse } from "next/server";
import { getSessionContext, type SessionContext } from "@/lib/auth";

export type Guard =
  | { ok: true; ctx: SessionContext & { org: NonNullable<SessionContext["org"]> } }
  | { ok: false; response: NextResponse };

/** Requires an authenticated user that belongs to an org. */
export async function requireOrg(): Promise<Guard> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!ctx.org) {
    return { ok: false, response: NextResponse.json({ error: "No organization" }, { status: 403 }) };
  }
  return { ok: true, ctx: { ...ctx, org: ctx.org } };
}
