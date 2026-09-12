import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import fs from "node:fs";
import { config, ROOT } from "./config.ts";
import { getState, runJob } from "./jobs.ts";
import { addIdea, addTicker, listFactors } from "./universe.ts";
import { publishTextState, publishWatchlist } from "./mqtt.ts";
import { listTickers } from "./universe.ts";

export const drafts = { ticker: "", ideaTitle: "", ideaClaim: "", ideaFactor: "iran" };

export function buildApi() {
  const app = new Hono();
  app.use("/api/*", cors());

  app.get("/api/health", (c) => c.json({ ok: true, preview: config.previewUi }));
  app.get("/api/state", (c) => c.json(getState()));
  app.post("/api/jobs/:id/run", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    if (c.req.query("wait") === "0") {
      void runJob(id);
      return c.json({ queued: true, id });
    }
    const info = await runJob(id);
    return c.json(info);
  });
  app.post("/api/tickers", async (c) => {
    const body = await c.req.json<{ symbol?: string }>();
    const symbol = addTicker(body.symbol || drafts.ticker);
    drafts.ticker = "";
    publishWatchlist(listTickers("ticker").map((t) => t.symbol));
    publishTextState(drafts);
    return c.json({ symbol });
  });
  app.post("/api/ideas", async (c) => {
    const body = await c.req.json<{ title?: string; claim?: string; factorId?: string }>();
    const id = addIdea(
      body.title || drafts.ideaTitle,
      body.claim || drafts.ideaClaim,
      body.factorId || drafts.ideaFactor || "iran",
    );
    drafts.ideaTitle = "";
    drafts.ideaClaim = "";
    publishTextState(drafts);
    return c.json({ id, factors: listFactors() });
  });

  const dist = path.join(ROOT, "preview", "dist");
  if (config.previewUi && fs.existsSync(path.join(dist, "index.html"))) {
    app.use("/*", serveStatic({ root: dist }));
    app.get("*", (c) => {
      const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
      return c.html(html);
    });
  }

  return app;
}

export function startApi() {
  if (!config.previewUi) {
    console.log("[api] PREVIEW_UI off — sin HTTP de usuario (modo HAOS).");
    return;
  }
  const app = buildApi();
  const port = fs.existsSync(path.join(ROOT, "preview", "dist", "index.html")) ? config.previewPort : config.apiPort;
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  console.log(`[api] preview/API en http://0.0.0.0:${port}`);
}
