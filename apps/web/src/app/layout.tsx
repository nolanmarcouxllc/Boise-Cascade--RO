import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Route Consolidation — Boise Cascade",
  description:
    "Find same-day deliveries split across trucks and quantify the recoverable cost.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
