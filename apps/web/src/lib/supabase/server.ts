import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicDemoEnabled } from "@/lib/public-demo";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server Supabase client bound to the request cookies (anon key, RLS-scoped to
 * the signed-in user's org). Use in server components, route handlers, and
 * server actions for anything that should respect the user's permissions.
 *
 * Public demo exception: when there is no auth cookie and public demo mode is on,
 * this returns the read-only service-role client so guest page reads see the demo
 * org's data (RLS would otherwise return nothing to an anonymous visitor). Guests
 * never have a session, so getSessionContext() still returns null for them and
 * every write path stays protected.
 */
export function createClient() {
  const cookieStore = cookies();

  const signedIn = cookieStore.getAll().some((c) => c.name.includes("-auth-token"));
  if (!signedIn && publicDemoEnabled()) {
    return createAdminClient();
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Session refresh is handled by middleware, so this is safe to ignore.
          }
        },
      },
    },
  );
}
