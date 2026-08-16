import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api-auth";
import { runComparison, type NewOrderInput } from "@/lib/demo-compare";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby cap; first (cold) run warms the geometry cache

/**
 * Side-by-side "Bridge" comparison for the /compare demo page.
 * Body: {
 *   date?: "YYYY-MM-DD"  — omit to auto-pick the most illustrative day
 *   orders?: NewOrderInput[]  — parsed DMSi CSV rows to fold into the day
 * }
 */
export async function POST(request: Request) {
  const guard = await requireOrg(request);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const date: string | null = typeof body?.date === "string" ? body.date : null;
  const orders: NewOrderInput[] = Array.isArray(body?.orders) ? body.orders.slice(0, 50) : [];

  const result = await runComparison(guard.ctx.org.id, date, orders);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
