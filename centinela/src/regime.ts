import { getSetting, setSetting } from "./db.ts";
import { getQuote } from "./quotes.ts";
import { appSettings, quietHoursActive } from "./settings.ts";
import type { Regime, WhyItem } from "./types.ts";

export function currentRegime(): Regime {
  return (getSetting("regime", "NORMAL") as Regime) || "NORMAL";
}

export function scoreThreshold(regime: Regime = currentRegime()): number {
  const a = appSettings().alertas;
  switch (regime) {
    case "CRISIS":
      return a.scoreCrisis;
    case "HIGH ALERT":
      return a.scoreHigh;
    case "WATCH":
      return a.scoreWatch;
    default:
      return a.scoreNormal;
  }
}

export function cooldownMs(regime: Regime = currentRegime()): number {
  const a = appSettings().alertas;
  const min =
    regime === "CRISIS"
      ? a.cooldownCrisisMin
      : regime === "HIGH ALERT"
        ? a.cooldownHighMin
        : regime === "WATCH"
          ? a.cooldownWatchMin
          : a.cooldownNormalMin;
  return min * 60 * 1000;
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

  const g = appSettings().regimen;
  let regime: Regime = "NORMAL";
  if (spyD <= g.watchSpy || qqqD <= g.watchQqq || smhD <= g.watchSmh || vixLevel >= g.watchVix) regime = "WATCH";
  if (spyD <= g.highSpy || qqqD <= g.highQqq || smhD <= g.highSmh || vixLevel >= g.highVix) regime = "HIGH ALERT";
  if (spyD <= g.crisisSpy && qqqD <= g.crisisQqq && smhD <= g.crisisSmh) regime = "CRISIS";
  else if (smhD <= g.crisisSmh && (oilD >= g.crisisOil || vixD >= g.crisisVixChange)) regime = "CRISIS";

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
  if (regime === "CRISIS" && score >= appSettings().alertas.crisisBypassScore) return false;
  return quietHoursActive();
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
