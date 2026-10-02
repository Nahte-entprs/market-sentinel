import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url)).replaceAll("\\", "/");

/** @type {import('tailwindcss').Config} */
export default {
  content: [`${dir}/index.html`, `${dir}/src/**/*.{ts,tsx}`],
  theme: {
    extend: {
      colors: {
        ha: {
          bg: "var(--c-bg)",
          card: "var(--c-card)",
          nav: "var(--c-nav)",
          input: "var(--c-input)",
          inset: "var(--c-inset)",
          border: "var(--c-border)",
          text: "var(--c-text)",
          muted: "var(--c-muted)",
          accent: "var(--c-accent)",
          onaccent: "var(--c-on-accent)",
          green: "var(--c-green)",
          red: "var(--c-red)",
          amber: "var(--c-amber)",
        },
      },
      fontFamily: {
        sans: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
