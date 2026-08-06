import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.org) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <div className="mb-1 text-sm font-medium uppercase tracking-wide text-brand-700">
            One more step
          </div>
          <h1 className="text-2xl font-semibold text-ink">
            Name your organization
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Everything you upload and analyze is scoped to this organization.
          </p>
        </div>
        <OnboardingForm />
      </div>
    </main>
  );
}
