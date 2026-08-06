"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <button
      onClick={signOut}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-white/5 hover:text-ink"
    >
      Sign out
    </button>
  );
}
