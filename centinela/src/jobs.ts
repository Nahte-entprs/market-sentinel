import { db, json, nowIso, parseJson, getSetting } from "./db.ts";
import { isRth } from "./config.ts";
import { listFactors, listIdeas, listTickers } from "./universe.ts";
import { allQuoteSymbols, allQuotes, getQuote, refreshQuotes } from "./quotes.ts";
import { ingestFeeds, recentNews } from "./news.ts";
import { extractEntities, lexiconPolarity, matchThesis } from "./entities.ts";
import { tickersFromEntities } from "./graph.ts";
import { computeRegime, confidenceFrom, currentRegime, scoreThreshold } from "./regime.ts";
import { emitIfNeeded, lastAlert, lastDigest, listAlerts, saveDigest } from "./alerts.ts";
import { collectOtherSubs, collectWsbDaily, ensureRedditTables } from "./reddit-social.ts";
import { publishIdeas, publishJob, publishRegime, publishSocial, publishStatus, publishWatchlist } from "./mqtt.ts";
import type { Candidate, IdeaRecord, JobInfo, JobStatus, WhyItem } from "./types.ts";

type JobDef = {
  id: string;
  letter?: string;
  name: string;
  description: string;
  cadenceMs: () => number;
  run: () => Promise<string>;
};

const queue: string[] = [];
let running: string | null = null;
let drainPromise: Promise<void> | null = null;

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
  const r = await refreshQuotes(allQuoteSymbols());
  if (r.errors.length && r.ok === 0) throw new Error(r.errors[0]);
  return `${r.ok} cotizaciones` + (r.errors.length ? ` (${r.errors.length} errores)` : "");
}

function whyPriceVol(symbol: string): WhyItem[] {
  const q = getQuote(symbol);
  if (!q) return [];
  const items: WhyItem[] = [];
  if (Math.abs(q.changePct) >= 1.5) {
    items.push({
      text: `${symbol} ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}% a ${q.price}`,
      kind: "price",
      weight: Math.abs(q.changePct) >= 3 ? 4 : 2,
    });
  }
  if (q.volumeRatio >= 2.5) {
    items.push({
      text: `volumen ${q.volumeRatio.toFixed(1)}× promedio`,
      kind: "volume",
      weight: q.volumeRatio >= 4 ? 3 : 2,
    });
  }
  return items;
}

async function volumeJob() {
  const names = listTickers("ticker");
  const fired: string[] = [];
  for (const t of names) {
    const q = getQuote(t.symbol);
    if (!q) continue;
    const why = whyPriceVol(t.symbol);
    const sectorEtf = listTickers("etf").find((e) => e.sector === t.sector)?.symbol ?? "SMH";
    const sq = getQuote(sectorEtf);
    if (sq && Math.abs(sq.changePct) >= 2) {
      why.push({
        text: `${sectorEtf} ${sq.changePct >= 0 ? "+" : ""}${sq.changePct.toFixed(1)}% (sector ${t.sector})`,
        kind: "sector",
        weight: Math.abs(sq.changePct) >= 3 ? 3 : 2,
      });
    }
    if (!why.length) continue;
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
  return fired.length ? `alertas: ${fired.join(", ")}` : "sin umbrales de volumen";
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
  await ingestFeeds("market.sentiment");
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

async function redditJob() {
  ensureRedditTables();
  const run = await collectWsbDaily();
  publishSocial(run);
  const top = run.emerging.map((e) => e.ticker).join(",") || "none";
  const err = run.errors.length ? `; ${run.errors[0].slice(0, 80)}` : "";
  const note = `daily ${run.comments} cmt · emerging ${top}${err}`;
  console.log(`[job] reddit.rising ${note}`);
  return note;
}

async function redditSubsJob() {
  ensureRedditTables();
  const run = await collectOtherSubs();
  publishSocial(run);
  const top = run.emerging.map((e) => e.ticker).join(",") || "none";
  const err = run.errors.length ? `; ${run.errors.length} sub error` : "";
  const note = `subs ${run.comments} cmt · emerging ${top}${err}`;
  console.log(`[job] reddit.subs ${note}`);
  return note;
}

async function regimeJob() {
  const r = computeRegime();
  publishRegime(r, parseJson(getSetting("regime_why", "{}"), {}));
  publishWatchlist(listTickers("ticker").map((t) => t.symbol));
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
  await ingestFeeds("ideas.eval");
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
    "Sin eventos sobre umbral. No es consejo financiero.",
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

export const JOBS: JobDef[] = [
  { id: "quotes.poll", name: "Cotizaciones", description: "Precio y volumen del universo", cadenceMs: () => (isRth() ? 5 : 15) * 60_000, run: quotesJob },
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
    description: "Vs media y shocks de ETF",
    cadenceMs: () => (isRth() ? 5 : 15) * 60_000,
    run: volumeJob,
  },
  {
    id: "reddit.rising",
    letter: "E",
    name: "WSB daily",
    description: "Comentarios del daily: emergentes vs staples",
    cadenceMs: () => 15 * 60_000,
    run: redditJob,
  },
  {
    id: "reddit.subs",
    name: "Reddit subs",
    description: "stocks, pennystocks, investing, etc.",
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

export async function runJob(id: string): Promise<JobInfo> {
  queue.push(id);
  await drain();
  const def = JOBS.find((j) => j.id === id);
  if (!def) throw new Error(`job desconocido: ${id}`);
  return jobInfo(def);
}

async function drain() {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    while (queue.length) {
      const id = queue.shift()!;
      const def = JOBS.find((j) => j.id === id);
      if (!def) continue;
      running = id;
      setJob(id, "running", null, null);
      publishJob(jobInfo(def));
      try {
        const note = await def.run();
        setJob(id, "ok", null, note);
      } catch (err) {
        setJob(id, "error", (err as Error).message.slice(0, 240), null);
      }
      publishJob(jobInfo(def));
      running = null;
    }
  })().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

export function startScheduler() {
  for (const def of JOBS) {
    const tick = async () => {
      queue.push(def.id);
      await drain();
      setTimeout(tick, def.cadenceMs());
    };
    setTimeout(tick, 1500 + Math.random() * 2500);
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
    factors: listFactors(),
    ideas,
    quotes: allQuotes(),
    alerts: listAlerts(25),
    lastAlert: lastAlert(),
    digest: digest.text?.value ?? null,
    digestAt: digest.at?.value ?? null,
    news: recentNews(12, 25),
    graphHint: "Iran → oil/hormuz → SMH/MU",
    disclaimer: "No es consejo financiero. Datos delayed. Centinela es un radar, no un broker.",
    preview: true,
  };
}
