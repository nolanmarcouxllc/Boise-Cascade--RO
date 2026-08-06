import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS -- SERVER ONLY. Never import this
 * into a client component. Used for the few operations RLS can't express for an
 * authenticated user: creating an org + first membership (chicken-and-egg on the
 * orgs insert), and Storage writes to the private bucket.
 *
 * Every caller MUST first resolve and verify the acting user's org and pass an
 * explicit org_id -- the service role does no scoping on its own.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Server-side privileged operations " +
        "require it (see .env.local.example).",
    );
  }
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
