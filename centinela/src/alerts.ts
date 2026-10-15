import { db, id, json, nowIso, parseJson, getMeta, setMeta } from "./db.ts";
import { cooldownMs, currentRegime, scoreThreshold, suppressPush } from "./regime.ts";
import { appSettings, quietHoursActive } from "./settings.ts";
import { templateSummarize, maybeEnrich } from "./summarizer.ts";
import { publishAlert, publishDigest, publishEnrich, publishNotify, publishTickerAlert, notifyUrl } from "./mqtt.ts";
import type { AlertRecord, Candidate, Regime, TickerAlert } from "./types.ts";
import type { SocialRun } from "./reddit-social.ts";

export function lastAlert(): AlertRecord | null {
  const r = db.prepare("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!r) return null;
  return rowToAlert(r);
}

export function listAlerts(limit = 30): AlertRecord[] {
  const rows = db.prepare("SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
  return rows.map(rowToAlert);
}

function rowToAlert(r: Record<string, unknown>): AlertRecord {
  return {
    id: String(r.id),
    title: String(r.title),
    summary: String(r.summary),
    score: Number(r.score),
    confidence: Number(r.confidence),
    regime: r.regime as Regime,
    why: parseJson(String(r.why), []),
    jobIds: parseJson(String(r.job_ids), []),
    clusterId: r.cluster_id ? String(r.cluster_id) : null,
    symbols: parseJson(String(r.symbols), []),
    sources: parseJson(String(r.sources), []),
    createdAt: String(r.created_at),
    enrichedAt: r.enriched_at ? String(r.enriched_at) : null,
    enrichText: r.enrich_text ? String(r.enrich_text) : null,
  };
}

function inCooldown(clusterId: string | null | undefined, symbols: string[], newScore: number): boolean {
  const since = new Date(Date.now() - cooldownMs()).toISOString();
  if (clusterId) {
    const prev = db
      .prepare("SELECT score, created_at FROM alerts WHERE cluster_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(clusterId) as { score: number; created_at: string } | undefined;
    if (prev && prev.created_at >= since && newScore < prev.score + 2) return true;
  }
  if (symbols[0]) {
    const prev = db
      .prepare("SELECT score, created_at, symbols FROM alerts WHERE created_at >= ? ORDER BY created_at DESC LIMIT 12")
      .all(since) as { score: number; created_at: string; symbols: string }[];
    for (const p of prev) {
      const syms = parseJson<string[]>(p.symbols, []);
      if (syms.includes(symbols[0]) && newScore < p.score + 2) return true;
    }
  }
  return false;
}

export async function emitIfNeeded(c: Candidate): Promise<AlertRecord | null> {
  const regime = currentRegime();
  if (c.score < scoreThreshold(regime)) return null;
  if (inCooldown(c.clusterId, c.symbols, c.score)) return null;

  const summary = templateSummarize(c);
  const rec: AlertRecord = {
    id: id("alert"),
    title: c.title,
    summary,
    score: Math.round(c.score * 10) / 10,
    confidence: Math.round(c.confidence),
    regime,
    why: c.why,
    jobIds: c.jobIds,
    clusterId: c.clusterId ?? null,
    symbols: c.symbols,
    sources: c.sources,
    createdAt: nowIso(),
  };
  db.prepare(
    `INSERT INTO alerts (id, title, summary, score, confidence, regime, why, job_ids, cluster_id, symbols, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rec.id,
    rec.title,
    rec.summary,
    rec.score,
    rec.confidence,
    rec.regime,
    json(rec.why),
    json(rec.jobIds),
    rec.clusterId,
    json(rec.symbols),
    json(rec.sources),
    rec.createdAt,
  );

  // Snapshot T+0
  db.prepare(
    `INSERT OR REPLACE INTO reactions (alert_id, offset, ticker, ticker_price, sector, sector_price, ts) VALUES (?, 'T+0', ?, ?, ?, ?, ?)`,
  ).run(
    rec.id,
    rec.symbols[0] ?? null,
    rec.symbols[0]
      ? (db.prepare("SELECT price FROM quotes WHERE symbol = ?").get(rec.symbols[0]) as { price: number } | undefined)?.price ?? null
      : null,
    "SMH",
    (db.prepare("SELECT price FROM quotes WHERE symbol = 'SMH'").get() as { price: number } | undefined)?.price ?? null,
    rec.createdAt,
  );

  const shouldPush = !suppressPush(rec.score, regime);
  if (shouldPush) publishAlert(rec);

  void maybeEnrich(rec).then((text) => {
    if (!text) return;
    db.prepare("UPDATE alerts SET enrich_text = ?, enriched_at = ? WHERE id = ?").run(text, nowIso(), rec.id);
    if (shouldPush) publishEnrich(rec.id, text);
  });

  return rec;
}

/** Reserva el aviso de este ticker. No manda el teléfono: la pasada junta varios en un solo mensaje. */
export function claimTickerWatch(alert: TickerAlert): boolean {
  const last = getMeta(`ticker_watch_${alert.symbol}`);
  if (last && Date.now() - Date.parse(last) < cooldownMs()) return false;
  const steep = Math.abs(alert.changePct) >= appSettings().cartera.steepQuietPct;
  if (quietHoursActive() && alert.category !== "holding" && !steep) return false;
  setMeta(`ticker_watch_${alert.symbol}`, nowIso());
  return true;
}

function batchTitle(labels: string[]): string {
  const picked: string[] = [];
  for (const label of labels) {
    const next = [...picked, label];
    const hidden = labels.length - next.length;
    const text = hidden > 0 ? `${next.join(" · ")} · +${hidden}` : next.join(" · ");
    if (text.length > 80) break;
    picked.push(label);
  }
  if (!picked.length) return labels[0]?.slice(0, 80) || "Cartera";
  const hidden = labels.length - picked.length;
  return hidden > 0 ? `${picked.join(" · ")} · +${hidden}` : picked.join(" · ");
}

function fitLines(lines: string[], max: number): string {
  const kept: string[] = [];
  for (const line of lines) {
    const hidden = lines.length - (kept.length + 1);
    const tail = hidden > 0 ? `\n… y ${hidden} más` : "";
    const text = `${[...kept, line].join("\n")}${tail}`;
    if (text.length > max && kept.length) break;
    kept.push(line);
  }
  const hidden = lines.length - kept.length;
  const body = kept.join("\n");
  return hidden > 0 ? `${body}\n… y ${hidden} más` : body;
}

/** Un aviso de teléfono por pasada. El título muestra los movimientos más grandes. */
export function pushCarteraBatch(alerts: TickerAlert[]) {
  if (!alerts.length) return;
  const ranked = [...alerts].sort(
    (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || b.volumeRatio - a.volumeRatio,
  );
  for (const alert of ranked) publishTickerAlert(alert);
  const at = nowIso();
  if (ranked.length === 1) {
    const one = ranked[0];
    publishNotify({
      section: "cartera",
      title: one.title,
      message: one.message,
      url: notifyUrl("cartera"),
      at,
    });
    return;
  }
  const lines = ranked.map((a) => (a.message ? `${a.title} · ${a.message}` : a.title));
  publishNotify({
    section: "cartera",
    title: batchTitle(ranked.map((a) => a.title)),
    message: fitLines(lines, 1400),
    url: notifyUrl("cartera"),
    at,
  });
}

export function maybePushReddit(run: SocialRun): boolean {
  const spikes = (run.tickers24h ?? []).filter((t) => t.spike).slice(0, 4);
  if (!spikes.length) return false;
  const last = getMeta(`reddit_spike_${run.source}`);
  if (last && Date.now() - Date.parse(last) < cooldownMs()) return false;
  const huge = spikes.some((s) => s.last1h >= appSettings().reddit.alertLast1h);
  if (quietHoursActive() && !huge) return false;
  setMeta(`reddit_spike_${run.source}`, nowIso());
  const title =
    spikes.length === 1
      ? `${spikes[0].ticker} ${spikes[0].last1h}/h ×${spikes[0].velocity.toFixed(1)}`
      : spikes.map((s) => `${s.ticker} ${s.last1h}/h`).join(" · ");
  const message = spikes
    .map((s) => `${s.ticker}: ${s.comments} en 24h, ${s.last1h} en 1h (×${s.velocity.toFixed(1)})`)
    .join(" · ");
  publishNotify({
    section: "reddit",
    title: title.slice(0, 80),
    message,
    url: notifyUrl("reddit"),
    at: nowIso(),
  });
  return true;
}

export function maybePushCrisis(regime: Regime): boolean {
  if (regime !== "CRISIS") return false;
  const last = getMeta("regime_crisis_push");
  if (last && Date.now() - Date.parse(last) < appSettings().alertas.crisisPushHours * 3600_000) return false;
  setMeta("regime_crisis_push", nowIso());
  publishNotify({
    section: "radar",
    title: "Régimen CRISIS",
    message: "Umbrales más sensibles. Revisa el radar.",
    url: notifyUrl("radar"),
    at: nowIso(),
  });
  return true;
}

export function saveDigest(text: string) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('last_digest', ?)`).run(text);
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('last_digest_at', ?)`).run(nowIso());
  publishDigest(text);
}

export function lastDigest() {
  return {
    text: db.prepare("SELECT value FROM settings WHERE key = 'last_digest'").get() as { value: string } | undefined,
    at: db.prepare("SELECT value FROM settings WHERE key = 'last_digest_at'").get() as { value: string } | undefined,
  };
}
