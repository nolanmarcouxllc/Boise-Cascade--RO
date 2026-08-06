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
          400: "#7b93ec",
          500: "#5c79e6",
          600: "#4363d8",
          700: "#3450c0",
        },
        alert: "#e6194b",
        good: "#3cb44b",
        geo: "#f58231",
        ink: {
          DEFAULT: "#e8ecf4",
          muted: "#9aa6b8",
          faint: "#63708a",
        },
        surface: {
          DEFAULT: "#141a24",
          2: "#1b2230",
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
