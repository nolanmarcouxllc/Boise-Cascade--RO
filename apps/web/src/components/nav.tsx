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

// Public-demo visitors see only the two read-only showcase pages; the
// back-office / write pages are hidden (and their write actions are blocked
// server-side regardless).
const GUEST_LINKS = LINKS.filter((l) => l.href === "/dashboard" || l.href === "/compare");

export function Nav({ guest = false }: { guest?: boolean }) {
  const pathname = usePathname();
  const links = guest ? GUEST_LINKS : LINKS;
  return (
    <nav className="flex gap-1">
      {links.map((l) => {
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
