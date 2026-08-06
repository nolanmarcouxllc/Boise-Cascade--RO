import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";

// Entry point: send users where they belong based on session + onboarding state.
export default async function Home() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.org) redirect("/onboarding");
  redirect("/dashboard");
}
