import { listTickers, listTickersByCategory } from "./universe.ts";
import { getQuote, readVolumeSignal } from "./quotes.ts";
import { publishCartera, publishWatchlist } from "./mqtt.ts";
import { MIN_SLOT_SAMPLES } from "./volume.ts";
import { appSettings } from "./settings.ts";
import type { CarteraPosition, TickerCategory } from "./types.ts";
import type { TickerRow } from "./universe.ts";

const REC_LABEL: Record<string, string> = {
  strong_buy: "Compra fuerte",
  buy: "Compra",
  hold: "Mantener",
  sell: "Venta",
  underperform: "Infraponderar",
  strong_sell: "Venta fuerte",
};

function usd(n: number, digits = 2) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function recLabel(key: string | null, mean: number | null) {
  if (key && REC_LABEL[key]) return REC_LABEL[key];
  if (mean == null) return "sin rating";
  if (mean <= 1.5) return "Compra fuerte";
  if (mean <= 2.5) return "Compra";
  if (mean <= 3.5) return "Mantener";
  if (mean <= 4.5) return "Venta";
  return "Venta fuerte";
}

function pctFmt(n: number, digits = 1) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function sharesFmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 9 });
}

function maDelta(price: number | null, ma: number | null) {
  if (!price || !ma) return null;
  return ((price - ma) / ma) * 100;
}

function maBit(label: string, ma: number | null, delta: number | null) {
  if (ma == null) return `${label} n/d`;
  const dist = delta != null ? ` ${pctFmt(delta)}` : "";
  return `${label} ${usd(ma, 0)}${dist}`;
}

function ratioBit(ratio: number | null, samples: number) {
  if (ratio == null || samples < MIN_SLOT_SAMPLES) {
    return samples > 0 ? `n/d (${samples}d)` : "n/d";
  }
  return `${ratio.toFixed(1)}×`;
}

export function toPosition(t: TickerRow): CarteraPosition {
  const q = getQuote(t.symbol);
  const price = q?.price ?? null;
  const fair = t.fair_price;
  const fairDelta = fair && price ? ((price - fair) / fair) * 100 : null;
  const ma50Delta = maDelta(price, q?.ma50 ?? null);
  const ma100Delta = maDelta(price, q?.ma100 ?? null);
  const ma200Delta = maDelta(price, q?.ma200 ?? null);
  const rec = recLabel(q?.recKey ?? null, q?.recMean ?? null);
  const vol = q?.volumeRatio ?? null;
  const flow = readVolumeSignal(t.symbol);
  const w52h = q?.week52High ?? null;
  const w52l = q?.week52Low ?? null;
  let week52Pos: number | null = null;
  if (price && w52h && w52l && w52h > w52l) {
    week52Pos = ((price - w52l) / (w52h - w52l)) * 100;
  }
  const week52Line =
    w52h && w52l && week52Pos != null
      ? `52 sem ${week52Pos.toFixed(0)}% del rango ${usd(w52l, 0)}–${usd(w52h, 0)}`
      : "52 sem sin rango";

  const shares = t.shares;
  const market = shares > 0 && price ? shares * price : null;
  const sharesBit = shares > 0 ? `${sharesFmt(shares)} acc${market != null ? ` · ${usd(market, market >= 100 ? 0 : 2)}` : ""}` : "";
  const fairBit = fair ? `Fair ${usd(fair)} ${fairDelta != null ? pctFmt(fairDelta) : ""}`.trim() : "sin fair";
  const ratingBit = q?.analystCount ? `${rec} (${q.analystCount})` : rec;
  const ptBit = q?.targetMean ? ` · PT ${usd(q.targetMean)}` : "";
  const paceWord = flow.sessionDone ? "día" : "ritmo";
  const paceHint = flow.sessionDone ? " lo habitual" : " a esta hora";
  const fadeCut = appSettings().cartera[t.category].sessionFadeRatio;
  const paceLow =
    flow.paceRatio != null && flow.paceSamples >= MIN_SLOT_SAMPLES && flow.paceRatio <= fadeCut;
  const paceShown = ratioBit(flow.paceRatio, flow.paceSamples);
  const burstShown = ratioBit(flow.burstRatio, flow.burstSamples);
  const paceCore = paceShown.endsWith("×") ? `${paceWord} ${paceShown}${paceHint}` : `${paceWord} ${paceShown}`;
  const paceText = paceLow && paceShown.endsWith("×") ? `${paceCore} bajo` : paceCore;
  const burstText = burstShown.endsWith("×") ? `5m ${burstShown}` : `5m ${burstShown}`;

  let icon = "grey";
  if (fair && price) icon = price > fair ? "red" : "green";
  else if (q) icon = q.changePct >= 0 ? "green" : "red";
  const hot = (flow.burstRatio != null && flow.burstRatio >= 3) || (flow.paceRatio != null && flow.paceRatio >= 1.5);
  const fading = !hot && paceLow;

  return {
    symbol: t.symbol,
    name: t.name,
    category: t.category,
    shares,
    shares_fmt: sharesFmt(shares),
    market_value: market,
    market_value_fmt: market != null ? usd(market, market >= 100 ? 0 : 2) : null,
    fair,
    fair_fmt: fair ? usd(fair) : null,
    fair_delta_pct: fairDelta,
    fair_delta_fmt: fairDelta != null ? pctFmt(fairDelta) : "",
    price,
    price_fmt: price != null ? usd(price) : "n/d",
    change_pct: q?.changePct ?? null,
    change_fmt: q ? pctFmt(q.changePct) : "",
    rec_label: rec,
    rec_key: q?.recKey ?? null,
    analyst_count: q?.analystCount ?? null,
    target_mean: q?.targetMean ?? null,
    target_fmt: q?.targetMean ? usd(q.targetMean) : null,
    ma50: q?.ma50 ?? null,
    ma100: q?.ma100 ?? null,
    ma200: q?.ma200 ?? null,
    ma50_delta_pct: ma50Delta,
    ma100_delta_pct: ma100Delta,
    ma200_delta_pct: ma200Delta,
    volume_ratio: vol,
    burst_ratio: flow.burstRatio,
    burst_samples: flow.burstSamples,
    pace_ratio: flow.paceRatio,
    pace_samples: flow.paceSamples,
    session_done: flow.sessionDone,
    week52_high: w52h,
    week52_low: w52l,
    week52_pos: week52Pos,
    week52_line: week52Line,
    line2: `${sharesBit ? `${sharesBit} · ` : ""}${fairBit} · ${ratingBit}${ptBit}`,
    line3: `${maBit("50d", q?.ma50 ?? null, ma50Delta)} · ${maBit("100d", q?.ma100 ?? null, ma100Delta)} · ${maBit("200d", q?.ma200 ?? null, ma200Delta)} · ${paceText} · ${burstText} · ${week52Line}`,
    icon_color: icon,
    badge_icon: hot ? "mdi:fire" : fading ? "mdi:trending-down" : "",
    badge_color: hot ? "orange" : fading ? "grey" : "",
  };
}

export function listPositions(category: TickerCategory): CarteraPosition[] {
  const rows = listTickersByCategory(category).map(toPosition);
  if (category !== "holding") return rows;
  return rows.sort((a, b) => (b.market_value ?? -1) - (a.market_value ?? -1) || a.symbol.localeCompare(b.symbol));
}

export function publishCarteraState() {
  publishWatchlist(listTickers("ticker").map((t) => t.symbol));
  publishCartera({
    holding: listPositions("holding"),
    priority: listPositions("priority"),
    watch: listPositions("watchlist"),
  });
}
