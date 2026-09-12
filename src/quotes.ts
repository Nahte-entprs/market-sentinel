import { db, nowIso } from "./db.ts";
import { listTickers } from "./universe.ts";
import type { QuoteSnap } from "./types.ts";

const MACRO_SYMS = ["CL=F", "USDJPY=X", "^TNX", "^VIX"];

export function allQuoteSymbols() {
  const t = listTickers().map((x) => x.symbol);
  return [...new Set([...t, ...MACRO_SYMS])];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function persistQuote(q: {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  avgVolume: number;
}) {
  const volumeRatio = q.avgVolume > 0 ? q.volume / q.avgVolume : 0;
  db.prepare(
    `INSERT INTO quotes (symbol, price, prev_close, change_pct, volume, avg_volume, volume_ratio, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       price=excluded.price, prev_close=excluded.prev_close, change_pct=excluded.change_pct,
       volume=excluded.volume, avg_volume=excluded.avg_volume, volume_ratio=excluded.volume_ratio, ts=excluded.ts`,
  ).run(q.symbol, q.price, q.prevClose, q.changePct, q.volume, q.avgVolume, volumeRatio, nowIso());
  const day = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO quote_bars (symbol, date, close, volume) VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol, date) DO UPDATE SET close=excluded.close, volume=excluded.volume`,
  ).run(q.symbol, day, q.price, q.volume);
}

type ChartJson = {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketVolume?: number;
      };
      indicators?: { quote?: { close?: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
    error?: { description?: string };
  };
};

async function quoteChart(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as ChartJson;
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(j.chart?.error?.description || "sin datos");
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((n): n is number => typeof n === "number");
  const volumes = (result.indicators?.quote?.[0]?.volume ?? []).filter((n): n is number => typeof n === "number");
  const price = Number(result.meta?.regularMarketPrice ?? closes.at(-1) ?? 0);
  const prev = Number(result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? closes.at(-2) ?? price);
  if (!price) throw new Error("precio 0");
  const changePct = prev ? ((price - prev) / prev) * 100 : 0;
  const volume = Number(result.meta?.regularMarketVolume ?? volumes.at(-1) ?? 0);
  const avgVolume = volumes.length ? volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length) : avgFromBars(symbol);
  persistQuote({ symbol, price, prevClose: prev, changePct, volume, avgVolume });
}

export async function refreshQuotes(symbols: string[]): Promise<{ ok: number; errors: string[] }> {
  const errors: string[] = [];
  let ok = 0;
  const unique = [...new Set(symbols)].filter(Boolean);
  if (!unique.length) return { ok: 0, errors: ["sin símbolos"] };

  for (const symbol of unique) {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        await quoteChart(symbol);
        ok++;
        done = true;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429") && attempt < 2) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (attempt === 2) errors.push(`${symbol}: ${msg}`.slice(0, 100));
      }
    }
    await sleep(80);
  }
  return { ok, errors: errors.slice(0, 10) };
}

function avgFromBars(symbol: string) {
  const rows = db
    .prepare("SELECT volume FROM quote_bars WHERE symbol = ? ORDER BY date DESC LIMIT 20")
    .all(symbol) as { volume: number }[];
  if (!rows.length) return 0;
  return rows.reduce((a, b) => a + b.volume, 0) / rows.length;
}

export function getQuote(symbol: string): QuoteSnap | null {
  const r = db.prepare("SELECT * FROM quotes WHERE symbol = ?").get(symbol) as
    | {
        symbol: string;
        price: number;
        prev_close: number;
        change_pct: number;
        volume: number;
        avg_volume: number;
        volume_ratio: number;
        ts: string;
      }
    | undefined;
  if (!r) return null;
  return {
    symbol: r.symbol,
    price: r.price,
    prevClose: r.prev_close,
    changePct: r.change_pct,
    volume: r.volume,
    avgVolume: r.avg_volume,
    volumeRatio: r.volume_ratio,
    ts: r.ts,
  };
}

export function allQuotes(): QuoteSnap[] {
  const rows = db.prepare("SELECT * FROM quotes").all() as {
    symbol: string;
    price: number;
    prev_close: number;
    change_pct: number;
    volume: number;
    avg_volume: number;
    volume_ratio: number;
    ts: string;
  }[];
  return rows.map((r) => ({
    symbol: r.symbol,
    price: r.price,
    prevClose: r.prev_close,
    changePct: r.change_pct,
    volume: r.volume,
    avgVolume: r.avg_volume,
    volumeRatio: r.volume_ratio,
    ts: r.ts,
  }));
}
