import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import fs from "node:fs";
import { config, ROOT } from "./config.ts";
import { getState, runJob } from "./jobs.ts";
import { addIdea, listFactors, upsertTicker, removeTicker, parseCategory, moveTicker } from "./universe.ts";
import { mqttConnected, notifyUrl, publishNotify, publishTextState } from "./mqtt.ts";
import type { MqttDrafts } from "./mqtt.ts";
import { publishCarteraState } from "./portfolio.ts";
import { appSettings, saveAppSettings } from "./settings.ts";
import { listWindowComments } from "./reddit-social.ts";
import { nowIso } from "./db.ts";
import type { NotifySection } from "./types.ts";

export const drafts: MqttDrafts = {
  ticker: "",
  ideaTitle: "",
  ideaClaim: "",
  ideaFactor: "iran",
  category: "watchlist",
  shares: 0,
  fairPrice: 0,
};

function distDir() {
  return path.join(ROOT, "ui", "dist");
}

function ingressBase(header: string | undefined) {
  if (!header) return "./";
  return header.endsWith("/") ? header : `${header}/`;
}

export function buildApi() {
  const app = new Hono();
  app.use("/api/*", cors());

  app.get("/api/health", (c) => c.json({ ok: true, ui: config.previewUi }));
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
    const body = await c.req.json<{
      symbol?: string;
      category?: string;
      shares?: number;
      fairPrice?: number;
    }>();
    try {
      const symbol = upsertTicker({
        symbol: body.symbol || drafts.ticker,
        category: parseCategory(body.category),
        shares: body.shares,
        fairPrice: body.fairPrice,
      });
      drafts.ticker = "";
      publishCarteraState();
      publishTextState(drafts);
      return c.json({ symbol });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.post("/api/tickers/:symbol/move", async (c) => {
    const body = await c.req.json<{ dir?: "up" | "down" }>();
    const dir = body.dir === "down" ? "down" : "up";
    try {
      moveTicker(decodeURIComponent(c.req.param("symbol")), dir);
      publishCarteraState();
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.delete("/api/tickers/:symbol", (c) => {
    removeTicker(decodeURIComponent(c.req.param("symbol")));
    publishCarteraState();
    return c.json({ ok: true });
  });
  app.get("/api/settings", (c) => c.json(appSettings()));
  app.post("/api/settings", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "cuerpo inválido" }, 400);
    return c.json(saveAppSettings(body));
  });
  app.post("/api/test/notify", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "cuerpo inválido" }, 400);
    const raw = body as { section?: string; title?: string; message?: string };
    const allowed: NotifySection[] = ["radar", "cartera", "reddit", "ideas"];
    const section = allowed.includes(raw.section as NotifySection) ? (raw.section as NotifySection) : "reddit";
    const title = String(raw.title ?? "").trim().slice(0, 140);
    const message = String(raw.message ?? "").trim().slice(0, 400);
    if (!title || !message) return c.json({ error: "Falta título o mensaje" }, 400);
    if (!mqttConnected()) return c.json({ error: "MQTT no está conectado. El aviso no salió del add-on." }, 503);
    publishNotify({
      section,
      title,
      message,
      url: notifyUrl(section),
      at: nowIso(),
      tag: `centinela-test-${Date.now()}`,
    });
    console.log(`[test] notify ${section} · ${title}`);
    return c.json({ ok: true });
  });
  app.get("/api/reddit/comments", (c) => {
    const source = c.req.query("source") === "subs" ? "subs" : "wsb";
    const ticker = (c.req.query("ticker") || "").trim();
    if (ticker && !/^[A-Za-z0-9.]{1,10}$/.test(ticker)) return c.json({ error: "ticker inválido" }, 400);
    const offset = Math.max(0, Number(c.req.query("offset") || 0) || 0);
    return c.json(listWindowComments(source, ticker, offset));
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

  const dist = distDir();
  if (config.previewUi && fs.existsSync(path.join(dist, "index.html"))) {
    app.use("/assets/*", serveStatic({ root: dist }));
    const sendIndex = (c: Context) => {
      if (c.req.path.startsWith("/api")) return c.json({ error: "not found" }, 404);
      let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
      html = html.replaceAll("__INGRESS_BASE__", ingressBase(c.req.header("X-Ingress-Path")));
      return c.html(html);
    };
    app.get("/", sendIndex);
    app.get("/*", sendIndex);
  }

  return app;
}

export function startApi() {
  if (!config.previewUi) {
    console.log("[api] PREVIEW_UI off — sin HTTP de usuario.");
    return;
  }
  const app = buildApi();
  serve({ fetch: app.fetch, port: config.apiPort, hostname: "0.0.0.0" });
  const ui = fs.existsSync(path.join(distDir(), "index.html")) ? " + UI" : " (solo API)";
  console.log(`[api] http://0.0.0.0:${config.apiPort}${ui}`);
}
