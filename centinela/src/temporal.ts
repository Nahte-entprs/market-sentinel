import { db, getMeta, setMeta, readJsonFile } from "./db.ts";
import { config } from "./config.ts";
import { redditHeat } from "./reddit-social.ts";
import { getTicker, listTickers, listTickersByCategory, retireTemporal, upsertTicker } from "./universe.ts";

const CAP = 15;

function localDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function quietKey(symbol: string) {
  return `temporal_quiet_${symbol}`;
}

function bannedToday(symbol: string) {
  return getMeta(`temporal_ban_${symbol}`) === localDay();
}

function knownProfile(symbol: string): { name: string; sector: string } {
  const file = readJsonFile<{ tickers: { symbol: string; name: string; sector: string }[] }>("universe.json");
  const hit = file.tickers.find((t) => t.symbol.toUpperCase() === symbol);
  return { name: hit?.name || symbol, sector: hit?.sector || "other" };
}

/** Mete en Temporal lo que está en pico en Reddit y saca lo que lleva dos pasadas frío. */
export function syncTemporalCartera(): string[] {
  const heat = redditHeat();
  const by = new Map(heat.map((h) => [h.ticker, h]));
  const owned = new Set(listTickers("ticker").filter((t) => t.category !== "temporal").map((t) => t.symbol));
  const added: string[] = [];
  const staying: { symbol: string; heat: number }[] = [];

  for (const row of listTickersByCategory("temporal")) {
    const h = by.get(row.symbol);
    if (h?.spike) {
      setMeta(quietKey(row.symbol), "0");
      staying.push({ symbol: row.symbol, heat: h.last1h });
      continue;
    }
    const quiet = Number(getMeta(quietKey(row.symbol)) || "0") + 1;
    setMeta(quietKey(row.symbol), String(quiet));
    if (quiet >= 2) retireTemporal(row.symbol);
    else staying.push({ symbol: row.symbol, heat: h?.last1h ?? 0 });
  }

  const inside = new Set(staying.map((s) => s.symbol));
  const candidates = heat
    .filter((h) => {
      const row = getTicker(h.ticker);
      return h.spike && !owned.has(h.ticker) && !inside.has(h.ticker) && !bannedToday(h.ticker) && (!row || row.kind === "ticker");
    })
    .sort((a, b) => b.last1h - a.last1h || b.velocity - a.velocity);

  for (const c of candidates) {
    if (staying.length >= CAP) {
      const coldest = [...staying].sort((a, b) => a.heat - b.heat || a.symbol.localeCompare(b.symbol))[0];
      if (!coldest || c.last1h <= coldest.heat) break;
      retireTemporal(coldest.symbol);
      staying.splice(
        staying.findIndex((s) => s.symbol === coldest.symbol),
        1,
      );
    }
    const profile = knownProfile(c.ticker);
    upsertTicker({ symbol: c.ticker, name: profile.name, sector: profile.sector, category: "temporal" });
    setMeta(quietKey(c.ticker), "0");
    staying.push({ symbol: c.ticker, heat: c.last1h });
    added.push(c.ticker);
  }

  const order = [...staying].sort((a, b) => b.heat - a.heat || a.symbol.localeCompare(b.symbol));
  const upd = db.prepare("UPDATE tickers SET sort_order = ? WHERE symbol = ? AND category = 'temporal'");
  order.forEach((row, i) => upd.run(i + 1, row.symbol));
  return added;
}
