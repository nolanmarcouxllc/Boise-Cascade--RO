// Boise Cascade tree mark, rendered as inline SVG so it stays crisp and picks
// up the brand green via `currentColor`. To use the official raster asset
// instead, drop it in apps/web/public/ and swap this for <Image src=... />.
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Boise Cascade"
      fill="none"
    >
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="3.5" />
      {/* layered fir silhouette */}
      <path
        d="M32 13 L41 28 L36.5 28 L44 39 L38.5 39 L46 49 L18 49 L25.5 39 L20 39 L27.5 28 L23 28 Z"
        fill="currentColor"
      />
      <rect x="29.75" y="47" width="4.5" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}
