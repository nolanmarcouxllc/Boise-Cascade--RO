"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/compare", label: "Live comparison" },
  { href: "/uploads", label: "Upload data" },
  { href: "/analyze", label: "Find wasted trips" },
  { href: "/integrations", label: "Connected systems" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-brand-600/10 text-brand-700"
                : "text-ink-muted hover:bg-black/5 hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
