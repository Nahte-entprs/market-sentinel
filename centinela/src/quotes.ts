import { db, getMeta, nowIso, setMeta } from "./db.ts";
import { isRth } from "./config.ts";
import { listTickers } from "./universe.ts";
import type { QuoteSnap } from "./types.ts";
import { nyDay, PROFILE_SLOTS, volumeCurve, volumeSignal, type VolumeSignal } from "./volume.ts";
import { fetchCnbcDaily, fetchCnbcIntraday, fetchCnbcQuotes } from "./cnbc.ts";

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
  const fixed = moveFromBars(r.symbol, r.price);
  const changePct = fixed ? fixed.changePct : r.change_pct;
  const prevClose = fixed ? fixed.prev : r.prev_close;
  return {
    symbol: r.symbol,
    price: r.price,
    prevClose,
    changePct,
    changeTrusted: fixed != null || Math.abs(changePct) <= 80,
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

function quoteErrorKey(symbol: string) {
  return `quote_err_${symbol}`;
}

export function quoteError(symbol: string): string | null {
  const v = getMeta(quoteErrorKey(symbol));
  return v && v.trim() ? v : null;
}

function noteQuoteError(symbol: string, message: string | null) {
  const key = quoteErrorKey(symbol);
  if (!message) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  setMeta(key, message.slice(0, 140));
}

/** El porcentaje visible sale de las dos últimas velas diarias, nunca del ancla de un gráfico de un año. */
function moveFromBars(symbol: string, price: number): { prev: number; changePct: number } | null {
  const bars = db
    .prepare("SELECT date, close FROM quote_bars WHERE symbol = ? AND close > 0 ORDER BY date ASC")
    .all(symbol) as { date: string; close: number }[];
  if (bars.length < 2 || !(price > 0)) return null;
  const last = bars[bars.length - 1];
  const prior = bars[bars.length - 2];
  if (!(prior.close > 0) || !(last.close > 0)) return null;
  const today = nyDay(Date.now());
  const utcToday = new Date().toISOString().slice(0, 10);
  if (last.date === today || last.date === utcToday) {
    return { prev: prior.close, changePct: ((price - prior.close) / prior.close) * 100 };
  }
  if (Math.abs(price - last.close) / last.close > 0.002) {
    return { prev: last.close, changePct: ((price - last.close) / last.close) * 100 };
  }
  return { prev: prior.close, changePct: ((last.close - prior.close) / prior.close) * 100 };
}

/** Reescribe el cambio del día con las velas ya guardadas, sin esperar a Yahoo. */
export function repairMovesFromBars() {
  const rows = db.prepare("SELECT symbol, price FROM quotes").all() as { symbol: string; price: number }[];
  const upd = db.prepare("UPDATE quotes SET prev_close = ?, change_pct = ? WHERE symbol = ?");
  for (const row of rows) {
    const fixed = moveFromBars(row.symbol, row.price);
    if (!fixed) continue;
    upd.run(fixed.prev, fixed.changePct, row.symbol);
  }
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
  noteQuoteError(q.symbol, null);
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

const YAHOO_GAP_MS = 2500;
let nextYahooAt = 0;
let yahooPauseUntil = 0;
let yahooStrikes = 0;
let yahooPauseLogged = false;

export function resetYahooStrikes() {
  yahooStrikes = 0;
}

/** Dos símbolos seguidos limitados: esta vuelta no sigue golpeando a Yahoo. */
export function noteYahooStrike(): boolean {
  yahooStrikes += 1;
  return yahooStrikes >= 2;
}

export function yahooCooling(): boolean {
  return yahooPauseUntil - Date.now() > 15_000;
}

async function yahooJson<T>(path: string, timeoutMs: number): Promise<T> {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let last = "sin respuesta";
  for (let i = 0; i < hosts.length; i++) {
    const wait = Math.max(0, nextYahooAt - Date.now(), yahooPauseUntil - Date.now());
    if (yahooPauseUntil > Date.now() && wait > 5_000 && !yahooPauseLogged) {
      yahooPauseLogged = true;
      console.log(`[quote] Yahoo 429, pausa ${Math.ceil(wait / 1000)}s`);
    }
    if (wait > 0) await sleep(wait);
    yahooPauseLogged = false;
    nextYahooAt = Date.now() + YAHOO_GAP_MS;
    try {
      const res = await fetch(`https://${hosts[i]}${path}`, {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const pause = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 120_000) : 40_000;
        yahooPauseUntil = Date.now() + pause;
        nextYahooAt = yahooPauseUntil;
        throw new Error("429");
      }
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        if (res.status >= 500 && i === 0) continue;
        throw new Error(last);
      }
      yahooStrikes = 0;
      return (await res.json()) as T;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "429") throw err;
      const name = (err as Error).name;
      last = name === "TimeoutError" || name === "AbortError" ? "timeout" : msg;
      if (i === hosts.length - 1) throw new Error(last);
    }
  }
  throw new Error(last);
}

async function quoteChart(symbol: string) {
  const j = await yahooJson<ChartJson>(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`, 15000);
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(j.chart?.error?.description || "sin datos");
  const timestamps = result.timestamp ?? [];
  const rawClose = result.indicators?.quote?.[0]?.close ?? [];
  const rawVol = result.indicators?.quote?.[0]?.volume ?? [];
  const dates = timestamps.map(isoDayFromUnix);
  persistBars(symbol, dates, rawClose, rawVol);

  const closes = rawClose.filter((n): n is number => typeof n === "number");
  const price = Number(result.meta?.regularMarketPrice ?? closes.at(-1) ?? 0);
  const move = sessionMove(price, timestamps, rawClose);
  if (!price) throw new Error("precio 0");
  const prev = move.prev;
  const changePct = move.changePct;
  const lastVol = [...rawVol].reverse().find((n): n is number => typeof n === "number") ?? 0;
  const volume = Number(result.meta?.regularMarketVolume ?? lastVol);
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
  console.log(`[quote] ${symbol} ${price.toFixed(2)} ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`);
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
  const j = await yahooJson<ChartJson>(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1mo`, 20000);
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(j.chart?.error?.description || "sin barras 5m");
  const timestamps = result.timestamp ?? [];
  const rawClose = result.indicators?.quote?.[0]?.close ?? [];
  const rawVol = result.indicators?.quote?.[0]?.volume ?? [];
  persistIntraday(symbol, timestamps, rawClose, rawVol);
  const sessions = saveVolumeProfile(symbol);
  console.log(`[quote] ${symbol} curva ${sessions} sesiones`);
}

export async function refreshIntraday(symbols: string[], onEach?: () => void): Promise<{ ok: number; errors: string[]; stopped: boolean }> {
  const errors: string[] = [];
  let ok = 0;
  let stopped = false;
  const unique = [...new Set(symbols)].filter(Boolean);
  for (let i = 0; i < unique.length; i++) {
    const symbol = unique[i];
    try {
      await quoteIntraday(symbol);
      ok++;
      onEach?.();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("429")) {
        try {
          await quoteIntraday(symbol);
          ok++;
          onEach?.();
          continue;
        } catch (again) {
          const againMsg = (again as Error).message;
          console.error(`[quote] ${symbol} curva: ${againMsg}`);
          errors.push(`${symbol} 5m: ${againMsg}`.slice(0, 100));
          if (againMsg.includes("429") && noteYahooStrike()) {
            stopped = true;
            console.log(`[quote] Yahoo sigue en 429, curvas pendientes ${unique.length - i - 1}`);
            break;
          }
          continue;
        }
      }
      console.error(`[quote] ${symbol} curva: ${msg}`);
      errors.push(`${symbol} 5m: ${msg}`.slice(0, 100));
    }
  }
  return { ok, errors: errors.slice(0, 10), stopped };
}

function loadIntraday(symbol: string) {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  return db
    .prepare("SELECT ts, volume FROM quote_intraday WHERE symbol = ? AND ts >= ? ORDER BY ts ASC")
    .all(symbol, cutoff) as { ts: string; volume: number }[];
}

function saveVolumeProfile(symbol: string) {
  const curve = volumeCurve(loadIntraday(symbol));
  if (curve.samples < 5) return curve.samples;
  const ins = db.prepare(
    `INSERT INTO volume_profile (symbol, slot, avg_volume, samples, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(symbol, slot) DO UPDATE SET avg_volume=excluded.avg_volume, samples=excluded.samples, updated_at=excluded.updated_at`,
  );
  const ts = nowIso();
  const tx = db.transaction(() => {
    for (let slot = 0; slot < PROFILE_SLOTS; slot++) {
      ins.run(symbol, slot, curve.avg[slot] ?? 0, curve.samples, ts);
    }
  });
  tx();
  return curve.samples;
}

export type QuoteGaps = { missing: string[]; stale: string[]; noCurve: string[] };

/** Tickers sin fila de precio, con precio viejo, o sin la curva de 14 días guardada. */
export function symbolsToRenew(): QuoteGaps {
  const priceLimit = (isRth() ? 6 : 12) * 60_000;
  const curveLimit = 12 * 3600_000;
  const tickers = new Set(listTickers("ticker").map((t) => t.symbol));
  const missing: string[] = [];
  const stale: string[] = [];
  const noCurve: string[] = [];
  const priceRow = db.prepare("SELECT price, ts FROM quotes WHERE symbol = ?");
  const profileRow = db.prepare(
    "SELECT COUNT(*) AS n, MAX(samples) AS samples, MAX(updated_at) AS ts FROM volume_profile WHERE symbol = ?",
  );
  for (const symbol of allQuoteSymbols()) {
    const row = priceRow.get(symbol) as { price: number; ts: string } | undefined;
    if (!row || !(row.price > 0)) missing.push(symbol);
    else if (Date.now() - Date.parse(row.ts) > priceLimit) stale.push(symbol);
    if (!tickers.has(symbol)) continue;
    const profile = profileRow.get(symbol) as { n: number; samples: number | null; ts: string | null };
    const fresh =
      profile.n >= PROFILE_SLOTS - 2 &&
      (profile.samples ?? 0) >= 5 &&
      !!profile.ts &&
      Date.now() - Date.parse(profile.ts) < curveLimit;
    if (!fresh) noCurve.push(symbol);
  }
  return { missing, stale, noCurve };
}

/** Curva habitual de 14 días. Si la tabla está vacía y ya hay velas de 5 min, la calcula y la guarda. */
export function readVolumeCurve(symbol: string): { avg: number[]; today: number[] } {
  const stored = db
    .prepare("SELECT slot, avg_volume, samples, updated_at FROM volume_profile WHERE symbol = ? ORDER BY slot ASC")
    .all(symbol) as { slot: number; avg_volume: number; samples: number; updated_at: string }[];
  const fresh =
    stored.length >= PROFILE_SLOTS - 2 &&
    stored[0] &&
    Date.now() - Date.parse(stored[0].updated_at) < 6 * 3600_000;
  const bars = loadIntraday(symbol);
  const curve = volumeCurve(bars);
  if (!fresh && curve.samples >= 5) saveVolumeProfile(symbol);
  const avg = fresh
    ? Array.from({ length: PROFILE_SLOTS }, (_, i) => stored.find((r) => r.slot === i)?.avg_volume ?? 0)
    : curve.samples >= 5
      ? curve.avg
      : [];
  const today = curve.today.some((v) => v > 0) ? curve.today : [];
  return { avg, today };
}

/** Vela de 5 min contra su misma hora, y ritmo del día contra esa misma hora. */
export function readVolumeSignal(symbol: string): VolumeSignal {
  return volumeSignal(loadIntraday(symbol));
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

/** Cambio contra la vela diaria anterior. Ignora chartPreviousClose: en un gráfico de 1 año ese campo es el precio de hace doce meses. */
function sessionMove(price: number, timestamps: number[], rawClose: (number | null)[]) {
  const pairs: { ny: string; close: number }[] = [];
  const n = Math.min(timestamps.length, rawClose.length);
  for (let i = 0; i < n; i++) {
    const close = rawClose[i];
    if (typeof close === "number" && close > 0) pairs.push({ ny: nyDay(timestamps[i] * 1000), close });
  }
  const last = pairs.at(-1);
  const prior = pairs.length >= 2 ? pairs[pairs.length - 2].close : 0;
  if (!last || !prior) return { prev: last?.close || price, changePct: 0 };
  const today = nyDay(Date.now());
  if (last.ny === today) return { prev: prior, changePct: ((price - prior) / prior) * 100 };
  const leftLastClose = Math.abs(price - last.close) / last.close > 0.002;
  if (leftLastClose) return { prev: last.close, changePct: ((price - last.close) / last.close) * 100 };
  return { prev: prior, changePct: ((last.close - prior) / prior) * 100 };
}

function masFromStored(symbol: string) {
  const rows = db.prepare("SELECT close FROM quote_bars WHERE symbol = ? AND close > 0 ORDER BY date ASC").all(symbol) as { close: number }[];
  const closes = rows.map((r) => r.close);
  return { ma50: sma(closes, 50), ma100: sma(closes, 100), ma200: sma(closes, 200) };
}

function writeMas(symbol: string) {
  const mas = masFromStored(symbol);
  db.prepare("UPDATE quotes SET ma50 = ?, ma100 = ?, ma200 = ? WHERE symbol = ?").run(mas.ma50, mas.ma100, mas.ma200, symbol);
}

export function needsDailyBars(symbol: string) {
  const row = db.prepare("SELECT COUNT(*) AS n, MAX(date) AS d FROM quote_bars WHERE symbol = ?").get(symbol) as {
    n: number;
    d: string | null;
  };
  if (!row || row.n < 40 || !row.d) return true;
  return Date.now() - Date.parse(`${row.d}T00:00:00Z`) > 5 * 86400_000;
}

/** Precios en una sola consulta a CNBC. El cambio es el del día, no el ancla de un año. */
export async function refreshFromCnbc(symbols: string[], onEach?: () => void): Promise<{ ok: number; missing: string[]; error?: string }> {
  const { quotes, missing, error } = await fetchCnbcQuotes(symbols);
  if (error) console.error(`[quote] CNBC ${error}`);
  let ok = 0;
  for (const q of quotes) {
    const mas = masFromStored(q.symbol);
    persistQuote({
      symbol: q.symbol,
      price: q.price,
      prevClose: q.prevClose,
      changePct: q.changePct,
      volume: q.volume,
      avgVolume: q.avgVolume,
      ma50: mas.ma50,
      ma100: mas.ma100,
      ma200: mas.ma200,
    });
    console.log(`[quote] ${q.symbol} ${q.price.toFixed(2)} ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}% · CNBC`);
    ok++;
    onEach?.();
  }
  for (const symbol of missing) {
    noteQuoteError(symbol, "CNBC sin datos");
    console.error(`[quote] ${symbol} CNBC sin datos`);
  }
  return { ok, missing, error };
}

export async function refreshCnbcDaily(symbol: string) {
  const bars = await fetchCnbcDaily(symbol);
  if (bars.length < 2) throw new Error("sin velas diarias");
  persistBars(symbol, bars.map((b) => b.date), bars.map((b) => b.close), bars.map((b) => b.volume));
  writeMas(symbol);
  console.log(`[quote] ${symbol} ${bars.length} velas diarias · CNBC`);
}

export async function refreshCnbcCurve(symbol: string) {
  const bars = await fetchCnbcIntraday(symbol);
  if (bars.length < 10) throw new Error("sin velas 5m");
  persistIntraday(
    symbol,
    bars.map((b) => Math.floor(b.ms / 1000)),
    bars.map((b) => b.close),
    bars.map((b) => b.volume),
  );
  const sessions = saveVolumeProfile(symbol);
  console.log(`[quote] ${symbol} curva ${sessions} sesiones · CNBC`);
  return sessions;
}

const refreshing = new Set<string>();

/** Cotización de un ticker recién guardado, sin esperar al sondeo de toda la lista. */
export function refreshSymbolSoon(symbol: string, onDone?: () => void) {
  const s = symbol.trim().toUpperCase();
  if (!s || refreshing.has(s)) return;
  refreshing.add(s);
  void (async () => {
    try {
      await refreshFromCnbc([s], onDone);
      try {
        await refreshCnbcDaily(s);
      } catch (err) {
        console.error(`[quote] ${s} diario: ${(err as Error).message}`);
      }
      try {
        await refreshCnbcCurve(s);
      } catch (err) {
        console.error(`[quote] ${s} curva: ${(err as Error).message}`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      noteQuoteError(s, msg);
      console.error(`[quote] ${s}: ${msg}`);
    } finally {
      refreshing.delete(s);
      onDone?.();
    }
  })();
}

async function fetchChart(symbol: string) {
  try {
    await quoteChart(symbol);
  } catch (err) {
    const last = err as Error;
    if (!last.message.includes("429")) throw last;
    await quoteChart(symbol);
  }
}

export async function refreshQuotes(symbols: string[], onFilled?: () => void): Promise<{ ok: number; errors: string[]; stopped: boolean }> {
  const errors: string[] = [];
  let ok = 0;
  let stopped = false;
  const unique = [...new Set(symbols)].filter(Boolean);
  if (!unique.length) return { ok: 0, errors: ["sin símbolos"], stopped: false };
  const missing = new Set(unique.filter((s) => !getQuote(s)));
  const ordered = [...missing, ...unique.filter((s) => !missing.has(s))];

  for (let i = 0; i < ordered.length; i++) {
    const symbol = ordered[i];
    try {
      await fetchChart(symbol);
      ok++;
      onFilled?.();
    } catch (err) {
      const msg = (err as Error).message;
      noteQuoteError(symbol, msg);
      console.error(`[quote] ${symbol} ${msg}`);
      errors.push(`${symbol}: ${msg}`.slice(0, 100));
      if (msg.includes("429") && noteYahooStrike()) {
        stopped = true;
        const left = ordered.length - i - 1;
        console.log(`[quote] Yahoo sigue en 429, paro esta vuelta. Quedan ${left}`);
        break;
      }
    }
  }
  return { ok, errors: errors.slice(0, 10), stopped };
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
  const j = await yahooJson<SummaryJson>(
    `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,defaultKeyStatistics`,
    15000,
  );
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

export async function refreshFundamentals(symbols: string[]): Promise<{ ok: number; errors: string[]; stopped: boolean }> {
  const errors: string[] = [];
  let ok = 0;
  let stopped = false;
  if (yahooCooling()) return { ok: 0, errors: ["Yahoo en pausa"], stopped: true };
  const unique = [...new Set(symbols)].filter(Boolean);
  for (let i = 0; i < unique.length; i++) {
    const symbol = unique[i];
    try {
      await quoteSummary(symbol);
      ok++;
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`${symbol}: ${msg}`.slice(0, 100));
      if (msg.includes("429") && noteYahooStrike()) {
        stopped = true;
        console.log(`[quote] fundamentals en pausa, quedan ${unique.length - i - 1}`);
        break;
      }
    }
  }
  return { ok, errors: errors.slice(0, 10), stopped };
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
