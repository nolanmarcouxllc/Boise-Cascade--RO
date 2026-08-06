import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (anon key). Subject to RLS: it can only ever see the
 * signed-in user's own org data. Use in client components.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
