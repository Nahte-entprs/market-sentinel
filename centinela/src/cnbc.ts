const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const SYMBOLS: Record<string, string> = {
  "CL=F": "@CL.1",
  "USDJPY=X": "JPY=",
  "^TNX": ".TNX",
  "^VIX": ".VIX",
};

export function cnbcSymbol(symbol: string) {
  return SYMBOLS[symbol] ?? symbol;
}

export function parseCnbcNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return NaN;
  const s = v.trim().replace(/,/g, "").replace(/%$/, "");
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)([KMB])?$/i);
  if (!m) return NaN;
  let n = Number(m[1]);
  const unit = (m[2] || "").toUpperCase();
  if (unit === "K") n *= 1e3;
  if (unit === "M") n *= 1e6;
  if (unit === "B") n *= 1e9;
  return n;
}

export type CnbcQuote = {
  symbol: string;
  price: number;
  changePct: number;
  prevClose: number;
  volume: number;
  avgVolume: number;
};

type FormattedQuote = {
  symbol?: string;
  code?: number;
  last?: string;
  change?: string;
  change_pct?: string;
  volume?: string;
  tendayavgvol?: string;
};

export async function fetchCnbcQuotes(symbols: string[]): Promise<{ quotes: CnbcQuote[]; missing: string[]; error?: string }> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const byCnbc = new Map(wanted.map((s) => [cnbcSymbol(s), s]));
  const quotes: CnbcQuote[] = [];
  const seen = new Set<string>();
  let error: string | undefined;
  for (let i = 0; i < wanted.length; i += 40) {
    const chunk = wanted.slice(i, i + 40);
    const path = chunk.map(cnbcSymbol).join("|");
    const url =
      "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=" +
      encodeURIComponent(path) +
      "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json";
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        error = `HTTP ${res.status}`;
        continue;
      }
      const j = (await res.json()) as {
        FormattedQuoteResult?: { FormattedQuote?: FormattedQuote | FormattedQuote[] };
      };
      const raw = j.FormattedQuoteResult?.FormattedQuote;
      const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const row of rows) {
        if (!row || row.code !== 0) continue;
        const ours = byCnbc.get(String(row.symbol || "").toUpperCase()) ?? byCnbc.get(String(row.symbol || ""));
        if (!ours) continue;
        const price = parseCnbcNumber(row.last);
        const change = parseCnbcNumber(row.change);
        const changePct = parseCnbcNumber(row.change_pct);
        if (!(price > 0) || !Number.isFinite(changePct)) continue;
        const prevClose = price - (Number.isFinite(change) ? change : 0);
        quotes.push({
          symbol: ours,
          price,
          changePct,
          prevClose: prevClose > 0 ? prevClose : price,
          volume: Number.isFinite(parseCnbcNumber(row.volume)) ? parseCnbcNumber(row.volume) : 0,
          avgVolume: Number.isFinite(parseCnbcNumber(row.tendayavgvol)) ? parseCnbcNumber(row.tendayavgvol) : 0,
        });
        seen.add(ours);
      }
    } catch (err) {
      const name = (err as Error).name;
      error = name === "TimeoutError" || name === "AbortError" ? "timeout" : (err as Error).message;
    }
  }
  return { quotes, missing: wanted.filter((s) => !seen.has(s)), error };
}

export type CnbcDaily = { date: string; close: number; volume: number };
export type CnbcIntra = { ms: number; close: number; volume: number };

type PriceBar = { close?: string; volume?: number; tradeTime?: string; tradeTimeinMills?: number };

async function fetchBars(symbol: string, range: "1M" | "5D"): Promise<PriceBar[]> {
  const url = `https://ts-api.cnbc.com/harmony/app/charts/${range}.json?symbol=${encodeURIComponent(cnbcSymbol(symbol))}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { barData?: { priceBars?: PriceBar[] }; statusMessage?: string };
  const bars = j.barData?.priceBars;
  if (!bars?.length) throw new Error(j.statusMessage || "sin velas");
  return bars;
}

export async function fetchCnbcDaily(symbol: string): Promise<CnbcDaily[]> {
  const bars = await fetchBars(symbol, "1M");
  const out: CnbcDaily[] = [];
  for (const bar of bars) {
    const t = bar.tradeTime || "";
    const close = parseCnbcNumber(bar.close);
    if (t.length < 8 || !(close > 0)) continue;
    out.push({
      date: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`,
      close,
      volume: typeof bar.volume === "number" ? bar.volume : 0,
    });
  }
  return out;
}

export async function fetchCnbcIntraday(symbol: string): Promise<CnbcIntra[]> {
  const bars = await fetchBars(symbol, "5D");
  const out: CnbcIntra[] = [];
  for (const bar of bars) {
    const close = parseCnbcNumber(bar.close);
    const ms = bar.tradeTimeinMills;
    if (!(close > 0) || typeof ms !== "number") continue;
    out.push({ ms, close, volume: typeof bar.volume === "number" ? bar.volume : 0 });
  }
  return out;
}
