import Parser from "rss-parser";
import { config } from "./config.ts";
import { db, id, json, nowIso, parseJson } from "./db.ts";
import { extractEntities, jaccard, tokenize } from "./entities.ts";
import type { NewsItem, SourceTier } from "./types.ts";
import { readJsonFile } from "./db.ts";

export type Feed = {
  id: string;
  name: string;
  tier: SourceTier;
  kind: string;
  jobs: string[];
  url: string;
};

export function feedsForJob(jobId: string): Feed[] {
  const file = readJsonFile<{ feeds: Feed[] }>("feeds.json");
  return file.feeds.filter((f) => f.jobs.includes(jobId));
}

const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": config.userAgent, Accept: "application/rss+xml, application/xml, text/xml, */*" },
});

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent, Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

function assignCluster(title: string, firstSeen: string): string {
  const tokens = tokenize(title);
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const recent = db
    .prepare("SELECT id, title, cluster_id, first_seen_at FROM news WHERE first_seen_at >= ? ORDER BY first_seen_at DESC LIMIT 80")
    .all(since) as { id: string; title: string; cluster_id: string; first_seen_at: string }[];
  for (const r of recent) {
    if (jaccard(tokens, tokenize(r.title)) >= 0.45) return r.cluster_id;
  }
  return `cl_${firstSeen.slice(0, 13)}_${tokens.slice(0, 3).join("_")}`.slice(0, 80);
}

export async function ingestFeeds(jobId: string): Promise<{ inserted: number; scanned: number; errors: string[] }> {
  const feeds = feedsForJob(jobId);
  let inserted = 0;
  let scanned = 0;
  const errors: string[] = [];
  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 40)) {
        scanned++;
        const title = (item.title || "").trim();
        const url = (item.link || item.guid || "").trim();
        if (!title || !url) continue;
        const publishedAt = item.isoDate || item.pubDate || nowIso();
        const firstSeen = nowIso();
        const entities = extractEntities(`${title} ${item.contentSnippet || ""}`);
        const clusterId = assignCluster(title, firstSeen);
        const nid = id("news");
        const existing = db.prepare("SELECT id, echo_count, tier FROM news WHERE url = ?").get(url) as
          | { id: string; echo_count: number; tier: string }
          | undefined;
        if (existing) {
          db.prepare("UPDATE news SET echo_count = echo_count + 1 WHERE id = ?").run(existing.id);
          continue;
        }
        try {
          db.prepare(
            `INSERT INTO news (id, title, url, source, tier, published_at, first_seen_at, cluster_id, entities, echo_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          ).run(nid, title, url, feed.name, feed.tier, publishedAt, firstSeen, clusterId, json(entities));
          inserted++;
        } catch {
          // unique url race
        }
      }
    } catch (err) {
      errors.push(`${feed.id}: ${(err as Error).message}`.slice(0, 180));
    }
  }
  return { inserted, scanned, errors };
}

export function recentNews(hours = 24, limit = 80): NewsItem[] {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const rows = db
    .prepare("SELECT * FROM news WHERE first_seen_at >= ? ORDER BY first_seen_at DESC LIMIT ?")
    .all(since, limit) as Record<string, string | number>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    url: String(r.url),
    source: String(r.source),
    tier: r.tier as SourceTier,
    publishedAt: String(r.published_at),
    firstSeenAt: String(r.first_seen_at),
    clusterId: String(r.cluster_id),
    entities: parseJson<string[]>(String(r.entities), []),
    echoCount: Number(r.echo_count),
  }));
}

export function clusterFirstSeenTier(clusterId: string): SourceTier | null {
  const row = db
    .prepare("SELECT tier FROM news WHERE cluster_id = ? ORDER BY first_seen_at ASC LIMIT 1")
    .get(clusterId) as { tier: SourceTier } | undefined;
  return row?.tier ?? null;
}
