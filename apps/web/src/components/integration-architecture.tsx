// Integration architecture — the one-page explainer Steve shows IT when asking
// them to grant DMSi + PC*MILER API access. Static, self-contained.

const STEPS = ["Clean up", "Check", "Combine", "Put in order"];

export function IntegrationArchitecture() {
  return (
    <section className="panel p-6">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Architecture
        </div>
        <h2 className="mt-1 text-lg font-semibold text-ink">
          Where this tool sits between your systems
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          The bridge between your order system and your routing system — it
          makes sure orders are grouped efficiently before routes are built. It
          does not replace DMSi or PC*MILER.
        </p>
      </div>

      {/* Flow diagram */}
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <SystemNode
          title="DMSi Agility"
          sub="Your order system"
          tone="neutral"
        />
        <Flow label="orders come in" />
        <div className="flex-[1.4] rounded-xl border-2 border-brand-600/40 bg-brand-50 p-4">
          <div className="text-center text-sm font-semibold text-brand-700">
            This tool
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="rounded-md border border-brand-600/30 bg-white px-2.5 py-1 text-[11px] font-medium text-ink">
                  {s}
                </span>
                {i < STEPS.length - 1 && <span className="text-brand-600">→</span>}
              </div>
            ))}
          </div>
        </div>
        <Flow label="one combined load per truck" />
        <SystemNode
          title="PC*MILER"
          sub="Your routing system"
          tone="neutral"
        />
      </div>

      {/* Three explainer columns */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ExplainerCard
          heading="What DMSi sends us"
          accent="text-ink"
          items={[
            "Order number and customer name",
            "Delivery address",
            "What's being shipped and how much it weighs",
            "When the customer wants it",
            "What time the order was released to dispatch",
          ]}
        />
        <ExplainerCard
          heading="What this tool does in the middle"
          accent="text-brand-700"
          items={[
            "Puts every order into one consistent format",
            "Checks every field for errors before using it",
            "Groups same-day orders onto the fewest trucks possible",
            "Makes sure no truck is loaded past the 48,000 lb legal limit",
            "Puts each truck's stops in the shortest driving order",
          ]}
        />
        <ExplainerCard
          heading="What PC*MILER gets back"
          accent="text-ink"
          items={[
            "One clean, combined load per truck",
            "Stops already in the best order",
            "Every load checked against the legal weight limit",
            "Truck size and type included, so routes avoid restricted roads",
            "Ready to route — no rework needed",
          ]}
        />
      </div>
    </section>
  );
}

function SystemNode({ title, sub }: { title: string; sub: string; tone: "neutral" }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-5 text-center shadow-sm">
      <div className="text-sm font-semibold text-ink">{title}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-faint">{sub}</div>
    </div>
  );
}

function Flow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 lg:w-32">
      <div className="text-center text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="mt-1 flex w-full items-center justify-center text-brand-600">
        {/* horizontal on desktop, vertical on mobile */}
        <span className="hidden lg:flex lg:w-full lg:items-center">
          <span className="h-px flex-1 bg-brand-600/40" />
          <span className="-ml-1">▸</span>
        </span>
        <span className="lg:hidden">▾</span>
      </div>
    </div>
  );
}

function ExplainerCard({
  heading,
  accent,
  items,
}: {
  heading: string;
  accent: string;
  items: string[];
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-2 p-4">
      <div className={`text-sm font-semibold ${accent}`}>{heading}</div>
      <ul className="mt-3 space-y-2 text-sm text-ink-muted">
        {items.map((it) => (
          <li key={it} className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-600/60" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
