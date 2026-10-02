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
          bg: "#111318",
          card: "#1c1d20",
          border: "#2c2e33",
          text: "#e8eaed",
          muted: "#9aa0a6",
          accent: "#03a9f4",
          green: "#4caf50",
          red: "#f44336",
          amber: "#ff9800",
        },
      },
      fontFamily: {
        sans: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
