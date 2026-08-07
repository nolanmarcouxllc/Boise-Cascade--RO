// Integration architecture — the one-page explainer Steve shows IT when asking
// them to grant DMSi + PC*MILER API access. Static, self-contained.

const STEPS = ["Normalize", "Validate", "Consolidate", "Sequence"];

export function IntegrationArchitecture() {
  return (
    <section className="panel p-6">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Architecture
        </div>
        <h2 className="mt-1 text-lg font-semibold text-ink">Where this tool sits in your stack</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          A diagnostic layer between order management and dispatch. It does not
          replace DMSi or PC*MILER — it reconciles the day&apos;s full order
          picture before routes are built.
        </p>
      </div>

      {/* Flow diagram */}
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <SystemNode
          title="DMSi Agility"
          sub="ERP · Order Management"
          tone="neutral"
        />
        <Flow label="orders + dispatch waves" />
        <div className="flex-[1.4] rounded-xl border-2 border-brand-600/40 bg-brand-50 p-4">
          <div className="text-center text-sm font-semibold text-brand-700">
            Route Consolidation Engine
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
        <Flow label="1 consolidated load / truck" />
        <SystemNode
          title="PC*MILER"
          sub="Commercial Vehicle Routing"
          tone="neutral"
        />
      </div>

      {/* Three explainer columns */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ExplainerCard
          heading="What DMSi provides"
          accent="text-ink"
          items={[
            "Order number & customer",
            "Ship-to address",
            "Product & weight",
            "Requested delivery window",
            "Dispatch wave / release time",
          ]}
        />
        <ExplainerCard
          heading="What we do in the middle"
          accent="text-brand-700"
          items={[
            "Normalize to one standard schema",
            "Validate & sanitize every field",
            "Consolidate same-day loads onto the fewest legal trucks",
            "Verify ≤ 48,000 lb payload per truck",
            "Sequence stops (nearest-neighbor)",
          ]}
        />
        <ExplainerCard
          heading="What PC*MILER receives"
          accent="text-ink"
          items={[
            "One consolidated load per truck",
            "Stops in optimized sequence",
            "Legal, weight-verified payloads",
            "53-ft flatbed vehicle profile",
            "Ready to route — no rework",
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
