import { CompareClient } from "./compare-client";

export const dynamic = "force-dynamic";

export default function ComparePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">
          See the difference the Bridge makes
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Same delivery orders, routed two ways. On the left, orders go straight
          to PC*MILER exactly as they leave the order system today — one truck per
          order. On the right, the Bridge combines orders that are going the same
          way onto shared trucks first, then routes them. Press{" "}
          <span className="font-medium text-ink">Run Comparison</span> to route
          both in real time and watch the trucks, miles, and cost drop.
        </p>
      </div>

      <CompareClient />
    </div>
  );
}
