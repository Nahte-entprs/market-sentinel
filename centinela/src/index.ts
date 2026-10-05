import { seedIfNeeded, addIdea, addTicker, upsertTicker, removeTicker, moveTicker, getTicker, parseCategory } from "./universe.ts";
import { startScheduler, runJob, listJobs } from "./jobs.ts";
import { startMqtt, publishTextState } from "./mqtt.ts";
import { startApi, drafts } from "./api.ts";
import { publishCarteraState } from "./portfolio.ts";
import { refreshSymbolSoon, repairMovesFromBars } from "./quotes.ts";
import { config } from "./config.ts";

seedIfNeeded();
repairMovesFromBars();

function refreshCartera() {
  try {
    publishCarteraState();
  } catch (e) {
    console.error("[cartera]", (e as Error).message);
  }
}

await startMqtt({
  onAddTicker: (s) => {
    try {
      addTicker(s);
      drafts.ticker = "";
      publishTextState(drafts);
      refreshSymbolSoon(s, refreshCartera);
      refreshCartera();
    } catch (e) {
      console.error("[ticker]", (e as Error).message);
    }
  },
  onSaveTicker: () => {
    try {
      const saved = upsertTicker({
        symbol: drafts.ticker,
        category: parseCategory(drafts.category),
        shares: drafts.shares,
        fairPrice: drafts.fairPrice,
      });
      publishTextState(drafts);
      refreshSymbolSoon(saved, refreshCartera);
      refreshCartera();
    } catch (e) {
      console.error("[ticker]", (e as Error).message);
    }
  },
  onRemoveTicker: () => {
    try {
      removeTicker(drafts.ticker);
      drafts.ticker = "";
      drafts.shares = 0;
      drafts.fairPrice = 0;
      drafts.category = "watchlist";
      publishTextState(drafts);
      refreshCartera();
    } catch (e) {
      console.error("[ticker]", (e as Error).message);
    }
  },
  onMoveTicker: (dir) => {
    try {
      moveTicker(drafts.ticker, dir);
      refreshCartera();
    } catch (e) {
      console.error("[ticker]", (e as Error).message);
    }
  },
  onTickerDraft: (s) => {
    const t = getTicker(s);
    if (!t || t.enabled !== 1) return;
    drafts.category = t.category;
    drafts.shares = t.shares;
    drafts.fairPrice = t.fair_price ?? 0;
    publishTextState(drafts);
  },
  onAddIdea: (title, claim, factor) => {
    try {
      addIdea(title, claim, factor || "iran");
      drafts.ideaTitle = "";
      drafts.ideaClaim = "";
      publishTextState(drafts);
    } catch (e) {
      console.error("[idea]", (e as Error).message);
    }
  },
  onRunJob: (id) => {
    void runJob(id);
  },
  onReady: refreshCartera,
  drafts,
});

startApi();
startScheduler();
refreshCartera();

console.log(
  `[centinela] arranque · TZ=${config.tz} · ui=${config.previewUi} · mqtt=${config.mqttUrl || "off"} · jobs=${listJobs().length}`,
);
