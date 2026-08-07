// Next.js instrumentation hook — runs once when the server boots. Starts the
// in-process consolidation scheduler (see lib/automation/scheduler.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/automation/scheduler");
    startScheduler();
  }
}
