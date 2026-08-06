import { createClient } from "@/lib/supabase/server";
import type { Org } from "@/lib/types";

export type SessionContext = {
  userId: string;
  email: string | null;
  org: Org | null; // null => user has no membership yet (needs onboarding)
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
