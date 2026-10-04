import { db, nowIso } from "./db.ts";
import { listTickers } from "./universe.ts";
import type { QuoteSnap } from "./types.ts";
import { nyDay, volumeSignal, type VolumeSignal } from "./volume.ts";

const MACRO_SYMS = ["CL=F", "USDJPY=X", "^TNX", "^VIX"];
const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export function allQuoteSymbols() {
  const t = listTickers().map((x) => x.symbol);
  return [...new Set([...t, ...MACRO_SYMS])];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

type QuoteRow = {
  symbol: string;
  price: number;
  prev_close: number;
  change_pct: number;
  volume: number;
  avg_volume: number;
  volume_ratio: number;
  ts: string;
  ma50: number | null;
  ma100: number | null;
  ma200: number | null;
  target_mean: number | null;
  rec_mean: number | null;
  rec_key: string | null;
  analyst_count: number | null;
  week52_high: number | null;
  week52_low: number | null;
};

function rowToSnap(r: QuoteRow): QuoteSnap {
  return {
    symbol: r.symbol,
    price: r.price,
    prevClose: r.prev_close,
    changePct: r.change_pct,
    volume: r.volume,
    avgVolume: r.avg_volume,
    volumeRatio: r.volume_ratio,
    ts: r.ts,
    ma50: r.ma50 ?? null,
    ma100: r.ma100 ?? null,
    ma200: r.ma200 ?? null,
    targetMean: r.target_mean ?? null,
    recMean: r.rec_mean ?? null,
    recKey: r.rec_key ?? null,
    analystCount: r.analyst_count ?? null,
    week52High: r.week52_high ?? null,
    week52Low: r.week52_low ?? null,
  };
}

function persistQuote(q: {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  avgVolume: number;
  ma50: number | null;
  ma100: number | null;
  ma200: number | null;
}) {
  const volumeRatio = q.avgVolume > 0 ? q.volume / q.avgVolume : 0;
  db.prepare(
    `INSERT INTO quotes (symbol, price, prev_close, change_pct, volume, avg_volume, volume_ratio, ts, ma50, ma100, ma200)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       price=excluded.price, prev_close=excluded.prev_close, change_pct=excluded.change_pct,
       volume=excluded.volume, avg_volume=excluded.avg_volume, volume_ratio=excluded.volume_ratio, ts=excluded.ts,
       ma50=excluded.ma50, ma100=excluded.ma100, ma200=excluded.ma200`,
  ).run(
    q.symbol,
    q.price,
    q.prevClose,
    q.changePct,
    q.volume,
    q.avgVolume,
    volumeRatio,
    nowIso(),
    q.ma50,
    q.ma100,
    q.ma200,
  );
}

function persistBars(symbol: string, dates: string[], closes: (number | null)[], volumes: (number | null)[]) {
  const ins = db.prepare(
    `INSERT INTO quote_bars (symbol, date, close, volume) VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol, date) DO UPDATE SET close=excluded.close, volume=excluded.volume`,
  );
  const tx = db.transaction(() => {
    const n = Math.min(dates.length, closes.length, volumes.length);
    for (let i = 0; i < n; i++) {
      const close = closes[i];
      if (typeof close !== "number") continue;
      const vol = typeof volumes[i] === "number" ? (volumes[i] as number) : 0;
      ins.run(symbol, dates[i], close, vol);
    }
  });
  tx();
}

type ChartJson = {
  chart?: {
    result?: {
      timestamp?: number[];
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

function isoDayFromUnix(sec: number) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

async function quoteChart(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as ChartJson;
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(j.chart?.error?.description || "sin datos");
  const timestamps = result.timestamp ?? [];
  const rawClose = result.indicators?.quote?.[0]?.close ?? [];
  const rawVol = result.indicators?.quote?.[0]?.volume ?? [];
  const dates = timestamps.map(isoDayFromUnix);
  persistBars(symbol, dates, rawClose, rawVol);

  const closes = rawClose.filter((n): n is number => typeof n === "number");
  const price = Number(result.meta?.regularMarketPrice ?? closes.at(-1) ?? 0);
  const prev = dailyBase(price, timestamps, rawClose, result.meta?.previousClose);
  if (!price) throw new Error("precio 0");
  const changePct = prev ? ((price - prev) / prev) * 100 : 0;
  const volume = Number(result.meta?.regularMarketVolume ?? volumes.at(-1) ?? 0);
  const histVol = historyVolumes(timestamps, rawVol);
  const avgVolume = histVol.length
    ? histVol.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, histVol.length)
    : avgFromBars(symbol);
  persistQuote({
    symbol,
    price,
    prevClose: prev,
    changePct,
    volume,
    avgVolume,
    ma50: sma(closes, 50),
    ma100: sma(closes, 100),
    ma200: sma(closes, 200),
  });
}

function persistIntraday(symbol: string, timestamps: number[], closes: (number | null)[], volumes: (number | null)[]) {
  const ins = db.prepare(
    `INSERT INTO quote_intraday (symbol, ts, close, volume) VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol, ts) DO UPDATE SET close=excluded.close, volume=excluded.volume`,
  );
  const tx = db.transaction(() => {
    const n = Math.min(timestamps.length, closes.length, volumes.length);
    for (let i = 0; i < n; i++) {
      const close = closes[i];
      if (typeof close !== "number") continue;
      const vol = typeof volumes[i] === "number" ? (volumes[i] as number) : 0;
      ins.run(symbol, new Date(timestamps[i] * 1000).toISOString(), close, vol);
    }
  });
  tx();
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  db.prepare("DELETE FROM quote_intraday WHERE symbol = ? AND ts < ?").run(symbol, cutoff);
}

async function quoteIntraday(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=10d`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as ChartJson;
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(j.chart?.error?.description || "sin barras 5m");
  const timestamps = result.timestamp ?? [];
  const rawClose = result.indicators?.quote?.[0]?.close ?? [];
  const rawVol = result.indicators?.quote?.[0]?.volume ?? [];
  persistIntraday(symbol, timestamps, rawClose, rawVol);
}

export async function refreshIntraday(symbols: string[]): Promise<{ ok: number; errors: string[] }> {
  const errors: string[] = [];
  let ok = 0;
  const unique = [...new Set(symbols)].filter(Boolean);
  for (const symbol of unique) {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        await quoteIntraday(symbol);
        ok++;
        done = true;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429") && attempt < 2) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (attempt === 2) errors.push(`${symbol} 5m: ${msg}`.slice(0, 100));
      }
    }
    await sleep(80);
  }
  return { ok, errors: errors.slice(0, 10) };
}

/** Vela de 5 min contra su misma hora, y ritmo del día contra esa misma hora. */
export function readVolumeSignal(symbol: string): VolumeSignal {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = db
    .prepare("SELECT ts, volume FROM quote_intraday WHERE symbol = ? AND ts >= ? ORDER BY ts ASC")
    .all(symbol, cutoff) as { ts: string; volume: number }[];
  return volumeSignal(rows);
}

function historyVolumes(timestamps: number[], rawVol: (number | null)[]) {
  const today = nyDay(Date.now());
  const out: number[] = [];
  const n = Math.min(timestamps.length, rawVol.length);
  for (let i = 0; i < n; i++) {
    const vol = rawVol[i];
    if (typeof vol !== "number" || vol <= 0) continue;
    if (nyDay(timestamps[i] * 1000) === today) continue;
    out.push(vol);
  }
  return out;
}

/** Base del cambio del día: el cierre de ayer, nunca el ancla de un gráfico de 1 año. */
function dailyBase(price: number, timestamps: number[], rawClose: (number | null)[], metaPrev?: number) {
  const pairs: { ny: string; close: number }[] = [];
  const n = Math.min(timestamps.length, rawClose.length);
  for (let i = 0; i < n; i++) {
    const close = rawClose[i];
    if (typeof close === "number" && close > 0) pairs.push({ ny: nyDay(timestamps[i] * 1000), close });
  }
  const last = pairs.at(-1);
  const prior = pairs.length >= 2 ? pairs[pairs.length - 2].close : 0;
  if (last && last.ny === nyDay(Date.now()) && prior > 0) return prior;
  if (metaPrev && metaPrev > 0 && last && Math.abs(metaPrev - last.close) / last.close <= 0.6) return metaPrev;
  if (prior > 0) return prior;
  return price;
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

type YahooNum = number | { raw?: number } | null | undefined;

function yahooRaw(v: YahooNum): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.raw === "number" && Number.isFinite(v.raw)) return v.raw;
  return null;
}

type SummaryJson = {
  quoteSummary?: {
    result?: {
      financialData?: {
        targetMeanPrice?: YahooNum;
        recommendationMean?: YahooNum;
        recommendationKey?: string;
        numberOfAnalystOpinions?: YahooNum;
      };
      defaultKeyStatistics?: {
        fiftyTwoWeekHigh?: YahooNum;
        fiftyTwoWeekLow?: YahooNum;
      };
    }[];
    error?: { description?: string };
  };
};

async function quoteSummary(symbol: string) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,defaultKeyStatistics`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as SummaryJson;
  const block = j.quoteSummary?.result?.[0];
  if (!block) throw new Error(j.quoteSummary?.error?.description || "sin fundamentals");
  const fd = block.financialData ?? {};
  const ks = block.defaultKeyStatistics ?? {};
  db.prepare(
    `UPDATE quotes SET target_mean=?, rec_mean=?, rec_key=?, analyst_count=?, week52_high=?, week52_low=? WHERE symbol=?`,
  ).run(
    yahooRaw(fd.targetMeanPrice),
    yahooRaw(fd.recommendationMean),
    fd.recommendationKey ?? null,
    yahooRaw(fd.numberOfAnalystOpinions),
    yahooRaw(ks.fiftyTwoWeekHigh),
    yahooRaw(ks.fiftyTwoWeekLow),
    symbol,
  );
}

export async function refreshFundamentals(symbols: string[]): Promise<{ ok: number; errors: string[] }> {
  const errors: string[] = [];
  let ok = 0;
  const unique = [...new Set(symbols)].filter(Boolean);
  for (const symbol of unique) {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        await quoteSummary(symbol);
        ok++;
        done = true;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429") && attempt < 2) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        if (attempt === 2) errors.push(`${symbol}: ${msg}`.slice(0, 100));
      }
    }
    await sleep(120);
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

export function threeDayTrend(symbol: string): { pct: number; dir: 1 | -1 } | null {
  const rows = db
    .prepare("SELECT date, close FROM quote_bars WHERE symbol = ? ORDER BY date DESC LIMIT 4")
    .all(symbol) as { date: string; close: number }[];
  if (rows.length < 4) return null;
  const closes = rows.map((r) => r.close).reverse();
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (!closes[i - 1]) return null;
    rets.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }
  if (rets.length < 3) return null;
  const last3 = rets.slice(-3);
  const allPos = last3.every((r) => r > 0);
  const allNeg = last3.every((r) => r < 0);
  if (!allPos && !allNeg) return null;
  return { pct: last3.reduce((a, b) => a + b, 0), dir: allPos ? 1 : -1 };
}

export function getQuote(symbol: string): QuoteSnap | null {
  const r = db.prepare("SELECT * FROM quotes WHERE symbol = ?").get(symbol) as QuoteRow | undefined;
  if (!r) return null;
  return rowToSnap(r);
}

export function allQuotes(): QuoteSnap[] {
  const rows = db.prepare("SELECT * FROM quotes").all() as QuoteRow[];
  return rows.map(rowToSnap);
}
