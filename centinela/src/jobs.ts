import { db, json, nowIso, parseJson, getSetting, getMeta, setMeta } from "./db.ts";
import { isExtendedHours, isRth } from "./config.ts";
import { listFactors, listIdeas, listTickers, listTickersByCategory } from "./universe.ts";
import { syncTemporalCartera } from "./temporal.ts";
import { allQuoteSymbols, allQuotes, getQuote, needsDailyBars, readVolumeSignal, refreshFromCnbc, refreshCnbcCurve, refreshCnbcDaily, refreshFundamentals, refreshSymbolSoon, SCREEN_QUOTE_SYMBOLS, symbolsToRenew, threeDayTrend } from "./quotes.ts";
import { claimTickerWatch, emitIfNeeded, lastAlert, lastDigest, listAlerts, maybePushCrisis, maybePushReddit, pushCarteraBatch, saveDigest } from "./alerts.ts";
import { ingestFeeds, recentNews } from "./news.ts";
import { extractEntities, lexiconPolarity, matchThesis } from "./entities.ts";
import { tickersFromEntities } from "./graph.ts";
import { computeRegime, confidenceFrom, currentRegime, scoreThreshold } from "./regime.ts";
import { collectOtherSubs, collectWsbDaily, ensureRedditTables, liveTickers } from "./reddit-social.ts";
import { mqttConnected, publishIdeas, publishJob, publishRegime, publishSocial, publishStatus } from "./mqtt.ts";
import { armJob, clearPhase, disarmJob, loopLag, onPulse, phaseOf, runInLane, setPhase, stillRunning, type Lane } from "./pulse.ts";
import { listPositions, publishCarteraState, publishLiveTape } from "./portfolio.ts";
import { loadSocialRun, saveSocialRun } from "./social-store.ts";
import { appSettings, watchBand } from "./settings.ts";
import type { Candidate, IdeaRecord, JobInfo, JobStatus, TickerAlert, WhyItem } from "./types.ts";

type JobDef = {
  id: string;
  letter?: string;
  name: string;
  description: string;
  cadenceMs: () => number;
  run: () => Promise<string>;
};

function setJob(id: string, status: JobStatus, error: string | null, note: string | null) {
  db.prepare(
    `INSERT INTO job_runs (job_id, last_run_at, last_status, last_error, last_note) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET last_run_at=excluded.last_run_at, last_status=excluded.last_status,
       last_error=excluded.last_error, last_note=excluded.last_note`,
  ).run(id, nowIso(), status, error, note);
}

function jobInfo(def: JobDef): JobInfo {
  const row = db.prepare("SELECT * FROM job_runs WHERE job_id = ?").get(def.id) as
    | { last_run_at: string | null; last_status: JobStatus; last_error: string | null; last_note: string | null }
    | undefined;
  return {
    id: def.id,
    letter: def.letter,
    name: def.name,
    description: def.description,
    cadenceMs: def.cadenceMs,
    lastRunAt: row?.last_run_at ?? null,
    lastStatus: row?.last_status ?? "idle",
    lastError: row?.last_error ?? null,
    lastNote: row?.last_note ?? null,
  };
}

async function quotesJob() {
  setPhase("cotizaciones");
  const live = new Set(listTickersByCategory("live").map((t) => t.symbol));
  const everyone = allQuoteSymbols();
  const symbols = everyone.filter((s) => !live.has(s));
  const before = symbolsToRenew();
  const show = (items: string[]) => (items.length ? items.join(", ") : "—");
  console.log(`[quote] CNBC · sin precio: ${show(before.missing)} · desactualizados: ${show(before.stale)} · sin curva: ${show(before.noCurve)}`);
  setPhase(`CNBC ${symbols.length} símbolos`);
  const r = symbols.length
    ? await refreshFromCnbc(symbols, () => publishCarteraState())
    : { ok: 0, missing: [] as string[], error: undefined as string | undefined };
  publishCarteraState();
  if (!stillRunning()) return "cortado por timeout";
  if (symbols.length && r.ok === 0) throw new Error(r.error || r.missing[0] || "CNBC sin precios");
  const needDaily = everyone.filter((s) => !r.missing.includes(s) && needsDailyBars(s));
  let dailyOk = 0;
  const dailyErr: string[] = [];
  for (const symbol of needDaily) {
    if (!stillRunning()) return "cortado por timeout";
    setPhase(`diaria ${symbol}`);
    try {
      await refreshCnbcDaily(symbol);
      dailyOk++;
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (err) {
      const msg = (err as Error).message;
      dailyErr.push(`${symbol}: ${msg}`);
      console.error(`[quote] ${symbol} diario: ${msg}`);
    }
  }
  const curves = symbolsToRenew().noCurve.filter((s) => !live.has(s) && !r.missing.includes(s));
  let curveOk = 0;
  const curveErr: string[] = [];
  for (const symbol of curves) {
    if (!stillRunning()) return "cortado por timeout";
    setPhase(`curva ${symbol}`);
    try {
      await refreshCnbcCurve(symbol);
      curveOk++;
      publishCarteraState();
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (err) {
      const msg = (err as Error).message;
      curveErr.push(`${symbol}: ${msg}`);
      console.error(`[quote] ${symbol} curva: ${msg}`);
    }
  }
  publishCarteraState();
  const bits = [`${r.ok} precios CNBC`, `${dailyOk} diarias`, curves.length ? `${curveOk} curvas` : "curvas al día"];
  const failed = r.missing.length + dailyErr.length + curveErr.length;
  if (failed) bits.push(`${failed} errores`);
  console.log(`[quote] listo · ${bits.join(" · ")}`);
  return bits.join(" · ");
}

async function fundamentalsJob() {
  setPhase("fundamentales");
  const r = await refreshFundamentals(listTickers("ticker").map((t) => t.symbol));
  if (!stillRunning()) return "cortado por timeout";
  publishCarteraState();
  if (r.stopped && r.ok === 0) return "Yahoo en pausa";
  if (r.errors.length && r.ok === 0) throw new Error(r.errors[0]);
  return `${r.ok} fundamentals` + (r.errors.length ? ` (${r.errors.length} errores)` : "");
}

function whyPriceVol(symbol: string): WhyItem[] {
  const q = getQuote(symbol);
  if (!q) return [];
  const band = appSettings().cartera;
  const items: WhyItem[] = [];
  if (q.changeTrusted && Math.abs(q.changePct) >= band.radarChangePct) {
    items.push({
      text: `${symbol} ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}% a ${q.price}`,
      kind: "price",
      weight: Math.abs(q.changePct) >= 3 ? 4 : 2,
    });
  }
  if (q.volumeRatio >= band.radarVolumeDaily) {
    items.push({
      text: `volumen ${q.volumeRatio.toFixed(1)}× promedio diario`,
      kind: "volume",
      weight: q.volumeRatio >= 4 ? 3 : 2,
    });
  }
  const flow = readVolumeSignal(symbol);
  if (flow.burstRatio != null && flow.burstRatio >= band.radarVolume5m) {
    items.push({
      text: `vela 5m ${flow.burstRatio.toFixed(1)}× lo normal a esta hora`,
      kind: "volume",
      weight: flow.burstRatio >= 5 ? 3 : 2,
    });
  }
  if (flow.paceRatio != null && flow.paceRatio >= band.radarSessionPace) {
    items.push({
      text: flow.sessionDone
        ? `volumen del día ${flow.paceRatio.toFixed(1)}× lo habitual`
        : `ritmo ${flow.paceRatio.toFixed(1)}× lo habitual a esta hora`,
      kind: "volume",
      weight: flow.paceRatio >= 2 ? 3 : 2,
    });
  } else if (
    !flow.sessionDone &&
    flow.barSlot != null &&
    flow.barSlot >= 6 &&
    flow.paceRatio != null &&
    flow.paceRatio <= band.radarSessionFade
  ) {
    items.push({
      text: `ritmo ${flow.paceRatio.toFixed(1)}× lo habitual a esta hora (impulso más bajo)`,
      kind: "volume",
      weight: 1,
    });
  }
  return items;
}

function money(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Lo que cabe en el título plegado del teléfono. El detalle queda en el cuerpo. */
function leadTag(reason: string): string {
  const mult = reason.match(/([\d.]+)×/);
  const pct = reason.match(/([+-][\d.]+%)/);
  if (/^vela 5m/.test(reason) && mult) return `5m ${mult[1]}×`;
  if (/^ritmo/.test(reason) && mult) return `ritmo ${mult[1]}×`;
  if (/^volumen/.test(reason) && mult) return `vol ${mult[1]}×`;
  if (/3d/.test(reason) && pct) return `3d ${pct[1]}`;
  if (pct && reason.includes("en el día")) return pct[1];
  return reason.slice(0, 42);
}

function carteraNotice(symbol: string, price: number, reasons: string[]) {
  const day = reasons.find((r) => r.includes("en el día"));
  const lead = day ?? reasons[0] ?? symbol;
  const title = `${symbol} ${leadTag(lead)}`.slice(0, 80);
  const rest = day ? reasons.filter((r) => r !== day) : reasons;
  const px = price > 0 ? `a ${money(price)}` : "";
  const message = [px, ...rest].filter(Boolean).join(" · ");
  return { title, message: message || lead };
}

async function volumeJob() {
  setPhase("volumen");
  const names = listTickers("ticker");
  const fired: string[] = [];
  const batch: TickerAlert[] = [];
  const finish = (cut: boolean) => {
    pushCarteraBatch(batch);
    const bits = [];
    if (fired.length) bits.push(`radar: ${fired.join(", ")}`);
    if (batch.length) bits.push(`cartera: ${batch.map((a) => a.symbol).join(", ")}`);
    const body = bits.length ? bits.join(" · ") : "sin umbrales de volumen";
    return cut ? `cortado por timeout · ${body}` : body;
  };
  for (const t of names) {
    if (t.category === "live") continue;
    if (!stillRunning()) return finish(true);
    setPhase(`volumen ${t.symbol}`);
    await Promise.resolve();
    const q = getQuote(t.symbol);
    if (!q) continue;
    const why = whyPriceVol(t.symbol);
    const sectorEtf = listTickers("etf").find((e) => e.sector === t.sector)?.symbol ?? "SMH";
    const sq = getQuote(sectorEtf);
    if (sq && Math.abs(sq.changePct) >= appSettings().cartera.sectorMovePct) {
      why.push({
        text: `${sectorEtf} ${sq.changePct >= 0 ? "+" : ""}${sq.changePct.toFixed(1)}% (sector ${t.sector})`,
        kind: "sector",
        weight: Math.abs(sq.changePct) >= 3 ? 3 : 2,
      });
    }
    if (why.length) {
      const score = why.reduce((a, w) => a + w.weight, 0);
      const wsbBoost = recentWsbBoost(t.symbol);
      if (wsbBoost) {
        why.push({ text: `WSB menciones ${wsbBoost.text} (confirmación)`, kind: "wsb", weight: 0 });
      }
      const cand: Candidate = {
        title: `Volumen/precio inusual en ${t.symbol}`,
        score,
        confidence: confidenceFrom(why, false, why.filter((w) => w.kind !== "wsb").length),
        why,
        jobIds: ["volume.unusual"],
        symbols: [t.symbol],
        sources: [],
      };
      if (why.filter((w) => w.kind === "wsb").length && why.filter((w) => w.kind !== "wsb").length === 0) {
        cand.score = Math.min(cand.score, 3);
      }
      const alert = await emitIfNeeded(cand);
      if (alert) fired.push(t.symbol);
    }

    const thresh = watchBand(t.category);
    const flow = readVolumeSignal(t.symbol);
    const reasons: string[] = [];
    if (q.changeTrusted && Math.abs(q.changePct) >= thresh.changePct) {
      reasons.push(`${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}% en el día`);
    }
    if (q.volumeRatio >= thresh.volumeRatio) {
      reasons.push(
        flow.sessionDone
          ? `volumen del día ${q.volumeRatio.toFixed(1)}× promedio`
          : `volumen ya ${q.volumeRatio.toFixed(1)}× un día normal`,
      );
    }
    let paceFresh = false;
    let fadeFresh = false;
    const paceKey = flow.sessionDate ? `vol_pace_${t.symbol}_${flow.sessionDate}` : "";
    const fadeKey = flow.sessionDate ? `vol_fade_${t.symbol}_${flow.sessionDate}` : "";
    if (flow.burstRatio != null && flow.burstRatio >= thresh.intradayVolumeRatio) {
      reasons.push(`vela 5m ${flow.burstRatio.toFixed(1)}× lo normal a esta hora`);
    }
    if (flow.paceRatio != null && flow.paceRatio >= thresh.sessionPaceRatio && paceKey) {
      const prevPace = Number(getMeta(paceKey) || "0");
      const already = prevPace > 0 && flow.paceRatio < prevPace + 0.5;
      if (!already) {
        paceFresh = true;
        reasons.push(
          flow.sessionDone
            ? `ritmo del día ${flow.paceRatio.toFixed(1)}× lo habitual`
            : `ritmo ${flow.paceRatio.toFixed(1)}× lo habitual a esta hora`,
        );
      }
    } else if (
      !flow.sessionDone &&
      flow.barSlot != null &&
      flow.barSlot >= 6 &&
      flow.paceRatio != null &&
      flow.paceRatio <= thresh.sessionFadeRatio &&
      fadeKey
    ) {
      const prevFade = Number(getMeta(fadeKey) || "0");
      const already = prevFade > 0 && flow.paceRatio > prevFade - 0.15;
      if (!already) {
        fadeFresh = true;
        reasons.push(`ritmo ${flow.paceRatio.toFixed(1)}× lo habitual a esta hora (pierde impulso)`);
      }
    }
    const trend = threeDayTrend(t.symbol);
    if (trend && Math.abs(trend.pct) >= thresh.trendPct) {
      const label = trend.dir > 0 ? "subida" : "bajada";
      reasons.push(`${label} 3d ${trend.pct >= 0 ? "+" : ""}${trend.pct.toFixed(1)}%`);
    }
    if (!reasons.length) continue;
    const notice = carteraNotice(t.symbol, q.price, reasons);
    const alert: TickerAlert = {
      symbol: t.symbol,
      category: t.category,
      title: notice.title,
      message: notice.message,
      changePct: q.changePct,
      volumeRatio: Math.max(q.volumeRatio, flow.burstRatio ?? 0, flow.paceRatio ?? 0),
      reasons,
      at: nowIso(),
    };
    if (!claimTickerWatch(alert)) continue;
    batch.push(alert);
    if (paceFresh && paceKey && flow.paceRatio != null) setMeta(paceKey, String(flow.paceRatio));
    if (fadeFresh && fadeKey && flow.paceRatio != null) setMeta(fadeKey, String(flow.paceRatio));
  }
  return finish(false);
}

function recentWsbBoost(symbol: string): { text: string; ratio: number } | null {
  const rows = db
    .prepare("SELECT captured_at, count FROM wsb_mentions WHERE ticker = ? ORDER BY captured_at DESC LIMIT 50")
    .all(symbol) as { captured_at: string; count: number }[];
  if (rows.length < 3) return null;
  const latest = rows[0].count;
  const baseline = rows.slice(1).reduce((a, b) => a + b.count, 0) / Math.max(1, rows.length - 1);
  if (baseline < 1) return latest >= 8 ? { text: `+${latest} (baseline bajo)`, ratio: 8 } : null;
  const ratio = latest / baseline;
  if (ratio >= 3) return { text: `+${Math.round((ratio - 1) * 100)}% vs 7d`, ratio };
  return null;
}

async function macroJob() {
  const news = await ingestFeeds("macro.scan");
  if (!stillRunning()) return `cortado por timeout · feeds +${news.inserted}`;
  const why: WhyItem[] = [];
  const oil = getQuote("CL=F");
  const yen = getQuote("USDJPY=X");
  const tnx = getQuote("^TNX");
  const vix = getQuote("^VIX");
  if (oil && Math.abs(oil.changePct) >= 2) {
    why.push({ text: `petróleo (CL) ${oil.changePct >= 0 ? "+" : ""}${oil.changePct.toFixed(1)}%`, kind: "macro", weight: Math.abs(oil.changePct) >= 4 ? 3 : 2 });
  }
  if (yen && Math.abs(yen.changePct) >= 1) {
    why.push({ text: `USDJPY ${yen.changePct >= 0 ? "+" : ""}${yen.changePct.toFixed(1)}%`, kind: "macro", weight: 2 });
  }
  if (tnx && Math.abs(tnx.changePct) >= 2) {
    why.push({ text: `yield 10Y ${tnx.changePct >= 0 ? "+" : ""}${tnx.changePct.toFixed(1)}%`, kind: "macro", weight: 2 });
  }
  if (vix && (vix.price >= 22 || vix.changePct >= 10)) {
    why.push({ text: `VIX ${vix.price.toFixed(1)} (${vix.changePct >= 0 ? "+" : ""}${vix.changePct.toFixed(1)}%)`, kind: "macro", weight: 2 });
  }
  const items = recentNews(6, 40).filter((n) => n.entities.some((e) => ["iran", "hormuz", "oil", "fed", "export_controls", "china"].includes(e)));
  const t0t1 = items.filter((n) => n.tier === "T0" || n.tier === "T1");
  if (t0t1.length) {
    why.push({
      text: `${t0t1.length} noticias T0/T1 de factores macro (first-seen)`,
      kind: "news",
      weight: t0t1[0].tier === "T0" ? 3 : 2,
    });
  }
  const smh = getQuote("SMH");
  if (smh && smh.changePct <= -2) {
    why.push({ text: `SMH ${smh.changePct.toFixed(1)}% — shock de semis`, kind: "sector", weight: 3 });
  }
  const hops = tickersFromEntities(["iran", "oil", "hormuz"]);
  if (hops.length && why.some((w) => w.kind === "news" || w.kind === "macro")) {
    why.push({
      text: `grafo: Iran/Hormuz → ${hops
        .slice(0, 6)
        .map((h) => h.symbol)
        .join(", ")}`,
      kind: "graph",
      weight: 2,
    });
  }
  const score = why.reduce((a, w) => a + w.weight, 0);
  if (why.length) {
    await emitIfNeeded({
      title: why.find((w) => w.kind === "news") ? "Macro/geopolítica en factores activos" : "Movimiento macro",
      score,
      confidence: confidenceFrom(why, t0t1.length > 0, t0t1.length),
      why,
      jobIds: ["macro.scan"],
      clusterId: t0t1[0]?.clusterId,
      symbols: hops.slice(0, 4).map((h) => h.symbol),
      sources: t0t1.slice(0, 4).map((n) => ({ title: n.title, url: n.url, tier: n.tier })),
    });
  }
  return `feeds +${news.inserted}/${news.scanned}` + (news.errors.length ? `; feeds caídos: ${news.errors.length}` : "");
}

async function tickerEventsJob() {
  const news = await ingestFeeds("ticker.events");
  if (!stillRunning()) return `cortado por timeout · +${news.inserted} noticias`;
  const items = recentNews(8, 60);
  const grouped = new Map<string, typeof items>();
  for (const n of items) {
    if (n.tier === "T2") continue; // eco: no first alert
    const exposed = tickersFromEntities(n.entities);
    for (const ex of exposed) {
      const list = grouped.get(ex.symbol) ?? [];
      list.push(n);
      grouped.set(ex.symbol, list);
    }
  }
  let fired = 0;
  for (const [symbol, ns] of grouped) {
    const first = ns.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))[0];
    if (first.tier === "T2" || first.tier === "T3") continue;
    const why: WhyItem[] = [];
    why.push({
      text: `${ns.length} noticia(s) ${first.tier} first-seen: ${first.title.slice(0, 90)}`,
      kind: "news",
      weight: first.tier === "T0" ? 4 : 3,
    });
    const echoes = ns.reduce((a, n) => a + n.echoCount, 0);
    if (echoes > 0) {
      why.push({ text: `${echoes} ecos T2 (narrativa masificándose)`, kind: "news", weight: 1 });
    }
    why.push(...whyPriceVol(symbol));
    const thesisHits = matchThesis(ns.map((n) => n.title).join(" "));
    for (const h of thesisHits.filter((x) => x.symbol === symbol).slice(0, 2)) {
      why.push({
        text: `toca pilar ${h.side} de ${h.symbol}: ${h.label}`,
        kind: "thesis",
        weight: 2,
      });
    }
    const wsb = recentWsbBoost(symbol);
    if (wsb && why.some((w) => w.kind !== "wsb")) {
      why.push({ text: `WSB ${wsb.text} (secundario)`, kind: "wsb", weight: 0 });
    }
    const score = why.reduce((a, w) => a + w.weight, 0);
    const alert = await emitIfNeeded({
      title: `Evento en ${symbol}`,
      score,
      confidence: confidenceFrom(why, true, ns.length),
      why,
      jobIds: ["ticker.events"],
      clusterId: first.clusterId,
      symbols: [symbol],
      sources: ns.slice(0, 4).map((n) => ({ title: n.title, url: n.url, tier: n.tier })),
    });
    if (alert) fired++;
    bumpNarrative(symbol, thesisHits.filter((x) => x.symbol === symbol));
  }
  await maybeDivergence();
  return `+${news.inserted} noticias, ${fired} alertas` + (news.errors.length ? `; ${news.errors.length} feeds error` : "");
}

function bumpNarrative(symbol: string, hits: { pillar: string; side: string }[]) {
  for (const h of hits) {
    const dir = h.side === "bear" || h.side === "risk" ? -1 : 1;
    const row = db.prepare("SELECT score FROM narrative WHERE ticker = ? AND pillar = ? AND window = '30d'").get(symbol, h.pillar) as
      | { score: number }
      | undefined;
    const prev = row?.score ?? 0;
    const next = Math.max(-10, Math.min(10, prev + dir));
    db.prepare(
      `INSERT INTO narrative (ticker, pillar, score, window, updated_at) VALUES (?, ?, ?, '30d', ?)
       ON CONFLICT(ticker, pillar, window) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at`,
    ).run(symbol, h.pillar, next, nowIso());
    if (Math.abs(next - prev) >= 2 || (Math.sign(next) !== Math.sign(prev) && prev !== 0)) {
      void emitIfNeeded({
        title: `Cambio de narrativa en ${symbol} / ${h.pillar}`,
        score: 7,
        confidence: 70,
        why: [
          {
            text: `pilar ${h.pillar}: ${prev.toFixed(0)} → ${next.toFixed(0)} (${h.side})`,
            kind: "narrative",
            weight: 3,
          },
        ],
        jobIds: ["ticker.events"],
        symbols: [symbol],
        sources: [],
      });
    }
  }
}

async function maybeDivergence() {
  for (const t of listTickers("ticker")) {
    const news = recentNews(24 * 5, 200).filter((n) => n.entities.includes(t.symbol) || tickersFromEntities(n.entities).some((x) => x.symbol === t.symbol));
    if (news.length < 4) continue;
    const polar = news.map((n) => lexiconPolarity(n.title));
    const bull = polar.filter((p) => p > 0).length;
    const bear = polar.filter((p) => p < 0).length;
    const q = getQuote(t.symbol);
    const sector = listTickers("etf").find((e) => e.sector === t.sector)?.symbol ?? "SMH";
    const sq = getQuote(sector);
    if (!q) continue;
    if (bull >= 6 && bear === 0 && q.changePct <= -3) {
      await emitIfNeeded({
        title: `Divergencia ${t.symbol}: noticias alcistas vs precio`,
        score: 7,
        confidence: 68,
        why: [
          { text: `${bull} titulares bullish / ${bear} bearish (5d)`, kind: "divergence", weight: 3 },
          { text: `${t.symbol} ${q.changePct.toFixed(1)}%`, kind: "price", weight: 3 },
          { text: `${sector} ${sq ? sq.changePct.toFixed(1) : "n/d"}%`, kind: "sector", weight: 1 },
        ],
        jobIds: ["ticker.events"],
        symbols: [t.symbol],
        sources: news.slice(0, 3).map((n) => ({ title: n.title, url: n.url, tier: n.tier })),
      });
    }
    if (bull >= 6 && Math.abs(q.changePct) < 1.2 && q.volumeRatio >= 3) {
      await emitIfNeeded({
        title: `Absorción ${t.symbol}: noticia sin mover precio`,
        score: 6,
        confidence: 60,
        why: [
          { text: `${bull} bullish, precio ${q.changePct.toFixed(1)}%`, kind: "divergence", weight: 2 },
          { text: `volumen ${q.volumeRatio.toFixed(1)}×`, kind: "volume", weight: 2 },
        ],
        jobIds: ["ticker.events"],
        symbols: [t.symbol],
        sources: [],
      });
    }
  }
}

async function sentimentJob() {
  const news = await ingestFeeds("market.sentiment");
  if (!stillRunning()) return `cortado por timeout · feeds +${news.inserted}`;
  const items = recentNews(12, 50);
  let bull = 0;
  let bear = 0;
  for (const n of items) {
    const p = lexiconPolarity(n.title);
    if (p > 0) bull++;
    if (p < 0) bear++;
  }
  const regime = currentRegime();
  const note = `léxico 12h: ${bull} alcista / ${bear} bajista · régimen ${regime}`;
  const spy = getQuote("SPY");
  const qqq = getQuote("QQQ");
  if (regime === "CRISIS" || regime === "HIGH ALERT") {
    await emitIfNeeded({
      title: `Sentimiento de mercado: ${regime}`,
      score: regime === "CRISIS" ? 8 : 6,
      confidence: 72,
      why: [
        { text: note, kind: "regime", weight: 2 },
        ...(spy ? [{ text: `SPY ${spy.changePct.toFixed(1)}%`, kind: "price" as const, weight: 2 }] : []),
        ...(qqq ? [{ text: `QQQ ${qqq.changePct.toFixed(1)}%`, kind: "price" as const, weight: 2 }] : []),
      ],
      jobIds: ["market.sentiment"],
      symbols: ["SPY", "QQQ"],
      sources: items.slice(0, 3).map((n) => ({ title: n.title, url: n.url, tier: n.tier })),
    });
  }
  return note;
}

function redditNote(
  run: { comments: number; windowComments: number; tickers24h: { ticker: string }[]; emerging: { ticker: string }[]; errors: string[] },
  pushed: boolean,
) {
  const top = (run.tickers24h[0]?.ticker ?? run.emerging[0]?.ticker) || "none";
  const err = run.errors.length ? ` · ${run.errors[0].slice(0, 140)}` : "";
  return `nuevos ${run.comments} · 24h ${run.windowComments} cmt · ${run.tickers24h.length} tkr · ${top}${pushed ? " · aviso" : ""}${err}`;
}

async function redditJob() {
  setPhase("reddit wsb");
  ensureRedditTables();
  const run = await collectWsbDaily();
  if (!stillRunning()) return `cortado por timeout · ${redditNote(run, false)}`;
  saveSocialRun(run);
  publishSocial(run);
  absorbTemporal();
  const pushed = maybePushReddit(run);
  return redditNote(run, pushed);
}

function absorbTemporal() {
  const added = syncTemporalCartera();
  for (const symbol of added) refreshSymbolSoon(symbol);
  publishCarteraState();
}

async function redditSubsJob() {
  setPhase("reddit subs");
  ensureRedditTables();
  const run = await collectOtherSubs();
  if (!stillRunning()) return `cortado por timeout · ${redditNote(run, false)}`;
  saveSocialRun(run);
  publishSocial(run);
  absorbTemporal();
  const pushed = maybePushReddit(run);
  return redditNote(run, pushed);
}

async function regimeJob() {
  const r = computeRegime();
  publishRegime(r, parseJson(getSetting("regime_why", "{}"), {}));
  maybePushCrisis(r);
  publishCarteraState();
  publishIdeas(mappedIdeas());
  publishStatus({ regime: r, jobs: JOBS.length });
  return r;
}

function mappedIdeas(): IdeaRecord[] {
  return listIdeas().map((i) => ({
    id: i.id,
    title: i.title,
    claim: i.claim,
    factorId: i.factor_id,
    verdict: i.verdict as IdeaRecord["verdict"],
    evidence: parseJson(i.evidence, []),
    updatedAt: i.updated_at,
  }));
}

async function ideasJob() {
  const ingested = await ingestFeeds("ideas.eval");
  if (!stillRunning()) return `cortado por timeout · feeds +${ingested.inserted}`;
  const news = recentNews(48, 80);
  let changes = 0;
  for (const idea of listIdeas()) {
    const factor = idea.factor_id;
    const related = news.filter((n) => n.entities.includes(factor) || extractEntities(n.title).includes(factor));
    let support = 0;
    let refute = 0;
    const evidence: { text: string; url?: string; direction: "support" | "refute" }[] = [];
    const supportKw = ["escalat", "prolong", "cannot end", "lost control", "out of control", "strait closed", "hormuz", "missile", "strike", "war"];
    const refuteKw = ["ceasefire", "truce", "deal reached", "ended the war", "withdrawal", "de-escalat", "peace"];
    for (const n of related) {
      const t = n.title.toLowerCase();
      const s = supportKw.some((k) => t.includes(k));
      const r = refuteKw.some((k) => t.includes(k));
      if (s && !r) {
        support++;
        evidence.push({ text: n.title.slice(0, 140), url: n.url, direction: "support" });
      } else if (r && !s) {
        refute++;
        evidence.push({ text: n.title.slice(0, 140), url: n.url, direction: "refute" });
      }
    }
    let verdict = idea.verdict;
    if (support >= 2 && refute === 0) verdict = "supported";
    else if (refute >= 2 && support === 0) verdict = "refuted";
    else if (support >= 1 && refute >= 1) verdict = "mixed";
    else if (related.length === 0) verdict = idea.verdict === "open" ? "open" : idea.verdict;
    if (verdict !== idea.verdict) {
      changes++;
      db.prepare("UPDATE ideas SET verdict = ?, evidence = ?, updated_at = ? WHERE id = ?").run(
        verdict,
        json(evidence.slice(0, 5)),
        nowIso(),
        idea.id,
      );
      await emitIfNeeded({
        title: `Tu idea «${idea.title}» pasa a ${verdict}`,
        score: 8,
        confidence: 75,
        why: [
          {
            text: `${verdict === "supported" ? "apoya" : verdict === "refuted" ? "refuta" : "matiza"}: ${idea.claim}`,
            kind: "idea",
            weight: 4,
          },
          { text: `${support} hechos a favor / ${refute} en contra (T0–T2, 48h)`, kind: "news", weight: 3 },
        ],
        jobIds: ["ideas.eval"],
        clusterId: related[0]?.clusterId,
        symbols: tickersFromEntities([factor]).slice(0, 4).map((x) => x.symbol),
        sources: related.slice(0, 3).map((n) => ({ title: n.title, url: n.url, tier: n.tier })),
      });
    } else {
      db.prepare("UPDATE ideas SET evidence = ?, updated_at = ? WHERE id = ?").run(json(evidence.slice(0, 5)), nowIso(), idea.id);
    }
  }
  publishIdeas(mappedIdeas());
  return `${listIdeas().length} ideas, ${changes} cambios de veredicto`;
}

async function digestJob() {
  const last = lastAlert();
  const lastAt = last?.createdAt ? Date.parse(last.createdAt) : 0;
  if (lastAt && Date.now() - lastAt < 90 * 60 * 1000 && (last?.score ?? 0) >= scoreThreshold()) {
    return "omitido: hubo alerta reciente";
  }
  const quotes = allQuotes();
  const smh = quotes.find((q) => q.symbol === "SMH");
  const spy = quotes.find((q) => q.symbol === "SPY");
  const oil = quotes.find((q) => q.symbol === "CL=F");
  const news = recentNews(2, 8);
  const ideas = listIdeas();
  const lines = [
    `Briefing ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })} · régimen ${currentRegime()}`,
    spy ? `SPY ${spy.changePct.toFixed(1)}%` : "SPY n/d",
    smh ? `SMH ${smh.changePct.toFixed(1)}% vol ${smh.volumeRatio.toFixed(1)}×` : "SMH n/d",
    oil ? `Petróleo ${oil.changePct.toFixed(1)}%` : "Oil n/d",
    news.length ? `Headlines: ${news.map((n) => n.title).slice(0, 3).join(" · ")}` : "Sin headlines nuevas",
    ...ideas.map((i) => `Idea ${i.title}: ${i.verdict}`),
    "Sin eventos sobre umbral.",
  ];
  saveDigest(lines.join("\n"));
  return "digest publicado";
}

async function reactionJob() {
  const alerts = listAlerts(20);
  let n = 0;
  for (const a of alerts) {
    const ageMin = (Date.now() - Date.parse(a.createdAt)) / 60000;
    const offsets: [string, number][] = [
      ["T+5m", 5],
      ["T+30m", 30],
      ["T+1h", 60],
      ["T+1d", 1440],
    ];
    for (const [name, min] of offsets) {
      if (ageMin < min) continue;
      const exists = db.prepare("SELECT 1 FROM reactions WHERE alert_id = ? AND offset = ?").get(a.id, name);
      if (exists) continue;
      const t = a.symbols[0];
      const tq = t ? getQuote(t) : null;
      const sq = getQuote("SMH");
      db.prepare(
        `INSERT INTO reactions (alert_id, offset, ticker, ticker_price, sector, sector_price, ts) VALUES (?, ?, ?, ?, 'SMH', ?, ?)`,
      ).run(a.id, name, t ?? null, tq?.price ?? null, sq?.price ?? null, nowIso());
      n++;
    }
  }
  return `${n} snapshots T+`;
}

let tapeCurveAt = 0;
let tapeCurveCursor = 0;

async function tapeJob() {
  const symbols = listTickersByCategory("live").map((t) => t.symbol);
  if (!symbols.length) {
    publishLiveTape();
    return "sin tickers";
  }
  setPhase("cinta");
  const r = await refreshFromCnbc([...new Set([...symbols, ...SCREEN_QUOTE_SYMBOLS])]);
  if (Date.now() - tapeCurveAt >= 60_000) {
    tapeCurveAt = Date.now();
    const symbol = symbols[tapeCurveCursor % symbols.length];
    tapeCurveCursor++;
    try {
      await refreshCnbcCurve(symbol);
    } catch (err) {
      console.error(`[cinta] ${symbol} curva: ${(err as Error).message}`);
    }
  }
  publishLiveTape();
  publishCarteraState();
  if (r.ok === 0 && (r.error || r.missing.length)) throw new Error(r.error || r.missing[0] || "CNBC sin precios");
  return `${r.ok} precios`;
}

export const JOBS: JobDef[] = [
  { id: "quotes.poll", name: "Cotizaciones", description: "Precio, volumen y medias móviles", cadenceMs: () => (isRth() ? 15 : 30) * 60_000, run: quotesJob },
  { id: "tape.live", name: "En tiempo real", description: "Precio de la cartera en vivo, para la pantalla", cadenceMs: () => (isExtendedHours() ? 10 : 60) * 1000, run: tapeJob },
  { id: "fundamentals.poll", name: "Fundamentals", description: "Rating analistas, PT y 52w", cadenceMs: () => 60 * 60_000, run: fundamentalsJob },
  { id: "regime.tick", name: "Régimen", description: "NORMAL → CRISIS", cadenceMs: () => (isRth() ? 5 : 15) * 60_000, run: regimeJob },
  {
    id: "macro.scan",
    letter: "A",
    name: "Macro",
    description: "Petróleo, yen, 10Y, VIX, Fed/BIS/EIA, Irán/Hormuz",
    cadenceMs: () => 20 * 60_000,
    run: macroJob,
  },
  {
    id: "ticker.events",
    letter: "B",
    name: "Eventos de ticker",
    description: "T0/T1, 8-K, tesis y grafo",
    cadenceMs: () => 10 * 60_000,
    run: tickerEventsJob,
  },
  {
    id: "market.sentiment",
    letter: "C",
    name: "Sentimiento",
    description: "Léxico + régimen + WSB como input",
    cadenceMs: () => 15 * 60_000,
    run: sentimentJob,
  },
  {
    id: "volume.unusual",
    letter: "D",
    name: "Volumen inusual",
    description: "Radar + vigilante: precio, ritmo por hora, vela 5m contra su horario, 3d",
    cadenceMs: () => (isRth() ? 5 : 15) * 60_000,
    run: volumeJob,
  },
  {
    id: "reddit.rising",
    letter: "E",
    name: "WSB daily",
    description: "WSB últimas 24 h: ritmo, picos y comentarios",
    cadenceMs: () => 15 * 60_000,
    run: redditJob,
  },
  {
    id: "reddit.subs",
    name: "Reddit subs",
    description: "Otros subs, mismas 24 h: ritmo y comentarios",
    cadenceMs: () => 20 * 60_000,
    run: redditSubsJob,
  },
  { id: "ideas.eval", name: "Ideas", description: "Apoyar / refutar claims", cadenceMs: () => 20 * 60_000, run: ideasJob },
  { id: "digest.brief", name: "Briefing 2h", description: "Resumen si no hubo HIGH", cadenceMs: () => 2 * 60 * 60_000, run: digestJob },
  { id: "reaction.snap", name: "Reacción T+", description: "T+5m / 30m / 1h / 1d", cadenceMs: () => 5 * 60_000, run: reactionJob },
];

export function listJobs(): JobInfo[] {
  return JOBS.map(jobInfo);
}

const FAST = new Set(["quotes.poll", "tape.live", "regime.tick", "volume.unusual", "reaction.snap"]);
const BUDGET_MS: Record<string, number> = {
  "quotes.poll": 3 * 60_000,
  "tape.live": 45_000,
  "regime.tick": 60_000,
  "volume.unusual": 2 * 60_000,
  "reaction.snap": 60_000,
  "fundamentals.poll": 8 * 60_000,
  "macro.scan": 4 * 60_000,
  "ticker.events": 4 * 60_000,
  "market.sentiment": 3 * 60_000,
  "reddit.rising": 3 * 60_000,
  "reddit.subs": 8 * 60_000,
  "ideas.eval": 4 * 60_000,
  "digest.brief": 60_000,
};

type Slot = { id: string; since: number; budgetMs: number };
const queues: Record<Lane, string[]> = { fast: [], slow: [] };
const drains: Record<Lane, Promise<void> | null> = { fast: null, slow: null };
const active: Record<Lane, Slot | null> = { fast: null, slow: null };
const lastOk = new Map<string, number>();
let lastBusyLog = 0;
let lastIdleLog = Date.now();
let lastStaleLog = 0;
let unhealthyLogged = "";

function laneOf(id: string): Lane {
  return FAST.has(id) ? "fast" : "slow";
}

function budgetFor(id: string) {
  return BUDGET_MS[id] ?? 4 * 60_000;
}

function enqueue(id: string, front: boolean) {
  const lane = laneOf(id);
  const q = queues[lane];
  if (q.includes(id)) return;
  if (front) q.unshift(id);
  else q.push(id);
}

function safeSetJob(id: string, status: JobStatus, error: string | null, note: string | null) {
  try {
    setJob(id, status, error, note);
  } catch (err) {
    console.error(`[job] ${id} no pude guardar estado: ${(err as Error).message}`);
  }
}

function safePublish(def: JobDef) {
  try {
    publishJob(jobInfo(def));
  } catch (err) {
    console.error(`[job] ${def.id} no pude publicar estado: ${(err as Error).message}`);
  }
}

function laneBit(lane: Lane) {
  const slot = active[lane];
  if (!slot) return `${lane} ocioso`;
  const cola = queues[lane].join(",") || "—";
  const secs = Math.round((Date.now() - slot.since) / 1000);
  return `${lane} ${slot.id} ${secs}s · fase ${phaseOf(lane)} · cola ${cola}`;
}

function noteStaleQuotes(now: number) {
  const quoteAt = lastOk.get("quotes.poll");
  if (!quoteAt || now - quoteAt <= 30 * 60_000 || now - lastStaleLog <= 10 * 60_000) return;
  lastStaleLog = now;
  console.error(`[watchdog] quotes.poll sin éxito hace ${Math.round((now - quoteAt) / 60000)}min`);
}

function logHeartbeat() {
  const now = Date.now();
  const lag = loopLag();
  noteStaleQuotes(now);
  const busy = (["fast", "slow"] as const).some((lane) => active[lane] && now - active[lane]!.since > 25_000);
  if (busy) {
    if (now - lastBusyLog < 30_000) return;
    lastBusyLog = now;
    console.log(`[watchdog] ${laneBit("fast")} · ${laneBit("slow")} · mqtt ${mqttConnected() ? "on" : "OFF"} · loop ${Math.round(lag / 1000)}s`);
    return;
  }
  if (now - lastIdleLog < 5 * 60_000) return;
  lastIdleLog = now;
  const quoteAt = lastOk.get("quotes.poll");
  const ago = quoteAt ? `quotes hace ${Math.round((now - quoteAt) / 60000)}min` : "quotes aún no";
  console.log(`[centinela] vivo · ${ago} · ${laneBit("fast")} · ${laneBit("slow")} · mqtt ${mqttConnected() ? "on" : "OFF"} · loop ${Math.round(lag / 1000)}s`);
}

function healthDetail() {
  const now = Date.now();
  const quoteAt = lastOk.get("quotes.poll");
  return {
    fast: active.fast?.id ?? null,
    slow: active.slow?.id ?? null,
    phaseFast: phaseOf("fast"),
    phaseSlow: phaseOf("slow"),
    loopLagMs: loopLag(),
    quotesAgeSec: quoteAt ? Math.round((now - quoteAt) / 1000) : null,
    mqtt: mqttConnected(),
  };
}

export function schedulerHealth() {
  const now = Date.now();
  const lag = loopLag();
  const fail = (reason: string) => {
    if (unhealthyLogged !== reason) {
      unhealthyLogged = reason;
      console.error(`[watchdog] salud mal: ${reason}`);
    }
    return { ok: false, reason, detail: healthDetail() };
  };
  if (lag > 60_000) return fail(`event loop atrasado ${Math.round(lag / 1000)}s`);
  for (const lane of ["fast", "slow"] as const) {
    const slot = active[lane];
    if (slot && now - slot.since > slot.budgetMs + 30_000) {
      return fail(`${slot.id} lleva ${Math.round((now - slot.since) / 1000)}s (tope ${Math.round(slot.budgetMs / 1000)}s) · fase ${phaseOf(lane)}`);
    }
  }
  if (unhealthyLogged) {
    console.log("[watchdog] salud recuperada");
    unhealthyLogged = "";
  }
  return { ok: true, reason: "ok", detail: healthDetail() };
}

async function runBounded(def: JobDef, lane: Lane, budget: number): Promise<string> {
  const live = armJob(def.id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      disarmJob(def.id);
      reject(new Error(`timeout ${Math.round(budget / 1000)}s · fase ${phaseOf(lane)}`));
    }, budget);
  });
  try {
    return await Promise.race([runInLane(lane, live, () => def.run()), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runJob(id: string): Promise<JobInfo> {
  const def = JOBS.find((j) => j.id === id);
  if (!def) throw new Error(`job desconocido: ${id}`);
  enqueue(id, false);
  await drain(laneOf(id));
  return jobInfo(def);
}

function drain(lane: Lane): Promise<void> {
  if (drains[lane]) return drains[lane]!;
  drains[lane] = (async () => {
    while (queues[lane].length) {
      const id = queues[lane].shift()!;
      const def = JOBS.find((j) => j.id === id);
      if (!def) continue;
      const budget = budgetFor(id);
      const started = Date.now();
      active[lane] = { id, since: started, budgetMs: budget };
      const cola = queues[lane].join(", ") || "—";
      console.log(`[job] ${lane} inicia ${id} · tope ${Math.round(budget / 1000)}s · cola ${cola} · mqtt ${mqttConnected() ? "on" : "OFF"}`);
      try {
        safeSetJob(id, "running", null, null);
        safePublish(def);
        const note = await runBounded(def, lane, budget);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        if (note.startsWith("cortado")) {
          console.error(`[job] ${lane} cortado ${id} ${secs}s · ${note}`);
          safeSetJob(id, "error", note.slice(0, 240), null);
        } else {
          console.log(`[job] ${lane} ok ${id} ${secs}s · ${note}`);
          safeSetJob(id, "ok", null, note);
          lastOk.set(id, Date.now());
        }
      } catch (err) {
        const msg = (err as Error).message.slice(0, 240);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        console.error(`[job] ${lane} error ${id} ${secs}s · ${msg}`);
        safeSetJob(id, "error", msg, null);
      } finally {
        active[lane] = null;
        clearPhase(lane);
        safePublish(def);
      }
    }
  })().finally(() => {
    drains[lane] = null;
    if (queues[lane].length) void drain(lane);
  });
  return drains[lane]!;
}

async function runTapeLoop() {
  const def = JOBS.find((j) => j.id === "tape.live");
  if (!def) return;
  const started = Date.now();
  try {
    safeSetJob(def.id, "running", null, null);
    safePublish(def);
    const note = await tapeJob();
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[job] cinta ok ${secs}s · ${note}`);
    safeSetJob(def.id, "ok", null, note);
    lastOk.set(def.id, Date.now());
  } catch (err) {
    const msg = (err as Error).message.slice(0, 240);
    console.error(`[job] cinta error · ${msg}`);
    safeSetJob(def.id, "error", msg, null);
  } finally {
    safePublish(def);
    const wait = Math.max(250, def.cadenceMs() - (Date.now() - started));
    setTimeout(() => void runTapeLoop(), wait);
  }
}

export function startScheduler() {
  onPulse(logHeartbeat);
  setTimeout(() => void runTapeLoop(), 4000);
  const ordered = [JOBS.find((j) => j.id === "quotes.poll")!, ...JOBS.filter((j) => j.id !== "quotes.poll")];
  for (const def of ordered) {
    if (def.id === "tape.live") continue;
    const lane = laneOf(def.id);
    const tick = async () => {
      try {
        enqueue(def.id, def.id === "quotes.poll");
        await drain(lane);
      } catch (err) {
        console.error(`[job] scheduler ${def.id}: ${(err as Error).message}`);
      } finally {
        setTimeout(tick, def.cadenceMs());
      }
    };
    const first = def.id === "quotes.poll" ? 1500 : def.id === "fundamentals.poll" ? 8 * 60_000 : 12_000 + Math.random() * 4000;
    setTimeout(tick, first);
  }
}

function overlayTickers(run: ReturnType<typeof loadSocialRun>, source: "wsb" | "subs") {
  if (!run) return null;
  try {
    return { ...run, tickers24h: liveTickers(source) };
  } catch {
    return run;
  }
}

export function getState() {
  const ideas = mappedIdeas();
  const digest = lastDigest();
  return {
    regime: currentRegime(),
    regimeWhy: parseJson(getSetting("regime_why", "{}"), {}),
    threshold: scoreThreshold(),
    jobs: listJobs(),
    tickers: listTickers("ticker"),
    etfs: listTickers("etf"),
    cartera: {
      holding: listPositions("holding"),
      priority: listPositions("priority"),
      watch: listPositions("watchlist"),
      temporal: listPositions("temporal"),
      live: listPositions("live"),
    },
    factors: listFactors(),
    ideas,
    quotes: allQuotes(),
    alerts: listAlerts(25),
    lastAlert: lastAlert(),
    digest: digest.text?.value ?? null,
    digestAt: digest.at?.value ?? null,
    news: recentNews(12, 25),
    reddit: {
      wsb: overlayTickers(loadSocialRun("wsb"), "wsb"),
      subs: overlayTickers(loadSocialRun("subs"), "subs"),
    },
    graphHint: "Iran → oil/hormuz → SMH/MU",
    settings: appSettings(),
    ingress: true,
  };
}
