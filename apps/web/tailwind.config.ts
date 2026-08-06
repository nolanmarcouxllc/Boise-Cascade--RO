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
          50: "#eef1fc",
          100: "#dfe5f9",
          200: "#c3ccf3",
          400: "#7b93ec",
          500: "#5c79e6",
          600: "#4363d8",
          700: "#3450c0",
        },
        alert: "#e6194b",
        good: "#16a34a",
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
