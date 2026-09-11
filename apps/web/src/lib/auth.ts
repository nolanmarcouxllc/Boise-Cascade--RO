import { createClient } from "@/lib/supabase/server";
import { publicDemoEnabled, resolvePublicOrg } from "@/lib/public-demo";
import type { Org } from "@/lib/types";

export type SessionContext = {
  userId: string;
  email: string | null;
  org: Org | null; // null => user has no membership yet (needs onboarding)
  isGuest?: boolean; // true => anonymous public-demo visitor (read-only)
};

/**
 * Resolve the signed-in user and their active org from the request session.
 * Returns null when there is no authenticated user.
 *
 * "Active org" is the user's first membership. Multi-org switching is a future
 * addition; the schema (memberships many-to-one) already supports it.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id, orgs(id, name, created_at)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // supabase types the joined relation loosely; normalize to our Org shape.
  const joined = (membership as { orgs?: Org | Org[] } | null)?.orgs;
  const org = Array.isArray(joined) ? (joined[0] ?? null) : (joined ?? null);

  return { userId: user.id, email: user.email ?? null, org };
}

/**
 * Viewer context for PUBLIC-facing surfaces (the app layout + read-only APIs):
 * the real signed-in context when there is one, otherwise — in public demo mode
 * — a read-only guest pinned to the demo org. Never use this to authorize a
 * write: getSessionContext() (which stays null for guests) is the write gate.
 */
export async function getViewerContext(): Promise<SessionContext | null> {
  const ctx = await getSessionContext();
  if (ctx) return ctx;
  if (publicDemoEnabled()) {
    const org = await resolvePublicOrg();
    if (org) return { userId: "public-guest", email: null, org, isGuest: true };
  }
  return null;
}
