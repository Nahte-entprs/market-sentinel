import { listTickers, listTickersByCategory } from "./universe.ts";
import { getQuote, lastBarVolumeVsMedian } from "./quotes.ts";
import { publishCartera, publishWatchlist } from "./mqtt.ts";
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

export function toPosition(t: TickerRow): CarteraPosition {
  const q = getQuote(t.symbol);
  const price = q?.price ?? null;
  const fair = t.fair_price;
  const fairDelta = fair && price ? ((fair - price) / price) * 100 : null;
  const ma50Delta = q?.ma50 && price ? ((price - q.ma50) / q.ma50) * 100 : null;
  const rec = recLabel(q?.recKey ?? null, q?.recMean ?? null);
  const vol = q?.volumeRatio ?? null;
  const intraVol = lastBarVolumeVsMedian(t.symbol);
  const w52h = q?.week52High ?? null;
  const w52l = q?.week52Low ?? null;
  let week52Pos: number | null = null;
  if (price && w52h && w52l && w52h > w52l) {
    week52Pos = ((price - w52l) / (w52h - w52l)) * 100;
  }
  const week52Line =
    w52h && w52l
      ? `52w ${week52Pos != null ? `${week52Pos.toFixed(0)}%` : "n/d"} (${usd(w52l, 0)}–${usd(w52h, 0)})`
      : "52w n/d";

  const fairBit = fair ? `Fair ${usd(fair)} · ${fairDelta != null ? pctFmt(fairDelta) : "n/d"}` : "sin fair";
  const ratingBit = q?.analystCount ? `${rec} (${q.analystCount})` : rec;
  const investedBit = t.category === "holding" && t.invested_usd > 0 ? `${usd(t.invested_usd, 0)} · ` : "";

  const ma50s = q?.ma50 != null ? usd(q.ma50, 0) : "—";
  const ma100s = q?.ma100 != null ? usd(q.ma100, 0) : "—";
  const ma200s = q?.ma200 != null ? usd(q.ma200, 0) : "—";
  const ma50bit = ma50Delta != null ? `${pctFmt(ma50Delta)} 50d` : "50d n/d";
  const volBit =
    intraVol != null && intraVol >= 1.5
      ? ` · 5m ${intraVol.toFixed(1)}×`
      : vol != null
        ? ` · vol ${vol.toFixed(1)}×`
        : "";
  const ptBit = q?.targetMean ? ` · PT ${usd(q.targetMean)}` : "";

  let icon = "grey";
  if (fair && price) icon = price < fair ? "green" : "red";
  else if (q) icon = q.changePct >= 0 ? "green" : "red";

  return {
    symbol: t.symbol,
    name: t.name,
    category: t.category,
    invested: t.invested_usd,
    invested_fmt: usd(t.invested_usd, 0),
    fair,
    fair_fmt: fair ? usd(fair) : null,
    fair_delta_pct: fairDelta,
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
    volume_ratio: vol,
    intraday_vol_ratio: intraVol,
    week52_high: w52h,
    week52_low: w52l,
    week52_pos: week52Pos,
    week52_line: week52Line,
    line2: `${investedBit}${fairBit} · ${ratingBit}${ptBit}`,
    line3: `50/100/200 ${ma50s} / ${ma100s} / ${ma200s} · ${ma50bit}${volBit} · ${week52Line}`,
    icon_color: icon,
    badge_icon: (intraVol != null && intraVol >= 3) || (vol != null && vol >= 2) ? "mdi:fire" : "",
    badge_color: (intraVol != null && intraVol >= 3) || (vol != null && vol >= 2) ? "orange" : "",
  };
}

export function listPositions(category: TickerCategory): CarteraPosition[] {
  return listTickersByCategory(category).map(toPosition);
}

export function publishCarteraState() {
  publishWatchlist(listTickers("ticker").map((t) => t.symbol));
  publishCartera({
    holding: listPositions("holding"),
    priority: listPositions("priority"),
    watch: listPositions("watchlist"),
  });
}
