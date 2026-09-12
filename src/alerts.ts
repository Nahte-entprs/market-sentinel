import { db, id, json, nowIso, parseJson } from "./db.ts";
import { cooldownMs, currentRegime, scoreThreshold, suppressPush } from "./regime.ts";
import { templateSummarize, maybeEnrich } from "./summarizer.ts";
import { publishAlert, publishEnrich, publishDigest } from "./mqtt.ts";
import type { AlertRecord, Candidate, Regime } from "./types.ts";

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
