import { getSetting, setSetting } from "./db.ts";
import { getQuote } from "./quotes.ts";
import { isQuietHours } from "./config.ts";
import type { Regime, WhyItem } from "./types.ts";

export function currentRegime(): Regime {
  return (getSetting("regime", "NORMAL") as Regime) || "NORMAL";
}

export function scoreThreshold(regime: Regime = currentRegime()): number {
  switch (regime) {
    case "CRISIS":
      return 4;
    case "HIGH ALERT":
      return 5;
    case "WATCH":
      return 6;
    default:
      return 8;
  }
}

export function cooldownMs(regime: Regime = currentRegime()): number {
  switch (regime) {
    case "CRISIS":
      return 8 * 60 * 1000;
    case "HIGH ALERT":
      return 20 * 60 * 1000;
    case "WATCH":
      return 35 * 60 * 1000;
    default:
      return 45 * 60 * 1000;
  }
}

export function computeRegime(): Regime {
  const spy = getQuote("SPY");
  const qqq = getQuote("QQQ");
  const smh = getQuote("SMH");
  const vix = getQuote("^VIX");
  const oil = getQuote("CL=F");
  const spyD = spy?.changePct ?? 0;
  const qqqD = qqq?.changePct ?? 0;
  const smhD = smh?.changePct ?? 0;
  const vixD = vix?.changePct ?? 0;
  const oilD = oil?.changePct ?? 0;
  const vixLevel = vix?.price ?? 0;

  let regime: Regime = "NORMAL";
  if (spyD <= -1 || qqqD <= -1.5 || smhD <= -2 || vixLevel >= 22) regime = "WATCH";
  if (spyD <= -1.5 || qqqD <= -2 || smhD <= -3 || vixLevel >= 26) regime = "HIGH ALERT";
  if (spyD <= -2 && qqqD <= -3 && smhD <= -4) regime = "CRISIS";
  else if (smhD <= -4 && (oilD >= 3 || vixD >= 15)) regime = "CRISIS";

  setSetting("regime", regime);
  setSetting(
    "regime_why",
    JSON.stringify({
      spy: spyD,
      qqq: qqqD,
      smh: smhD,
      vix: vixLevel,
      vixD,
      oil: oilD,
    }),
  );
  return regime;
}

export function suppressPush(score: number, regime: Regime): boolean {
  if (regime === "CRISIS" && score >= 7) return false;
  return isQuietHours();
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function confidenceFrom(why: WhyItem[], hasT0T1: boolean, corroborations: number): number {
  let c = 40 + why.length * 8 + (hasT0T1 ? 15 : 0) + corroborations * 6;
  const wsbOnly = why.every((w) => w.kind === "wsb") && why.length > 0;
  if (wsbOnly) c = Math.min(c, 28);
  return clamp(c, 5, 97);
}
