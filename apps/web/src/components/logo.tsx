/* eslint-disable @next/next/no-img-element */
// Official Boise Cascade logo (green tree mark + wordmark), served from
// public/boise-cascade-logo.svg. Wide lockup (~3.4:1) — size with a height
// class and let width follow (h-8 w-auto).
export function LogoMark({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <img
      src="/boise-cascade-logo.svg"
      alt="Boise Cascade"
      className={className}
      draggable={false}
    />
  );
}
