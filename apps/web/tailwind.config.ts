import type { Config } from "tailwindcss";

// Palette lifted from apps/engine/output/map.html so the app and the map read
// as one system. `brand` is the map's blue marker; alert/good/geo are the other
// categorical markers.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#e9f6ee",
          100: "#cdebd8",
          200: "#9dd6b4",
          400: "#35a866",
          500: "#159a4c",
          600: "#0a8a43",
          700: "#077a39",
        },
        alert: "#e6194b",
        good: "#0a8a43",
        geo: "#f58231",
        ink: {
          DEFAULT: "#0f172a",
          muted: "#55617a",
          faint: "#8a94a6",
        },
        surface: {
          DEFAULT: "#ffffff",
          2: "#f7f9fc",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
