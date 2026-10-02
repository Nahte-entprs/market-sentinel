import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      name: "ingress-base-dev",
      transformIndexHtml(html) {
        if (process.env.NODE_ENV === "production") return html;
        return html.replaceAll("__INGRESS_BASE__", "./");
      },
    },
  ],
  base: "./",
  root: dir,
  build: {
    outDir: path.join(dir, "dist"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 38447,
    proxy: {
      "/api": "http://127.0.0.1:18765",
    },
  },
});
