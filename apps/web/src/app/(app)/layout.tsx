import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out-button";

// Shell for every authenticated page. Guarantees a session + an org; otherwise
// bounces to /login or /onboarding. The org guarantee is what makes downstream
// pages able to assume `ctx.org` is non-null.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.org) redirect("/onboarding");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[rgba(11,14,20,0.82)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white shadow-[0_0_20px_rgba(67,99,216,0.5)]">
                RC
              </div>
              <span className="text-sm font-semibold text-ink">
                {ctx.org.name}
              </span>
            </div>
            <Nav />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">
              {ctx.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
