import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config, DATA_DIR, ROOT } from "./config.ts";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickers (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ticker',
  enabled INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sectors (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  etf TEXT NOT NULL,
  elevated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS factors (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  keywords TEXT NOT NULL,
  elevated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  claim TEXT NOT NULL,
  factor_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  evidence TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  symbol TEXT PRIMARY KEY,
  price REAL NOT NULL,
  prev_close REAL NOT NULL,
  change_pct REAL NOT NULL,
  volume INTEGER NOT NULL,
  avg_volume INTEGER NOT NULL,
  volume_ratio REAL NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_bars (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  volume INTEGER NOT NULL,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  tier TEXT NOT NULL,
  published_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  entities TEXT NOT NULL,
  echo_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  regime TEXT NOT NULL,
  why TEXT NOT NULL,
  job_ids TEXT NOT NULL,
  cluster_id TEXT,
  symbols TEXT NOT NULL,
  sources TEXT NOT NULL,
  created_at TEXT NOT NULL,
  enriched_at TEXT,
  enrich_text TEXT
);

CREATE TABLE IF NOT EXISTS job_runs (
  job_id TEXT PRIMARY KEY,
  last_run_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  last_note TEXT
);

CREATE TABLE IF NOT EXISTS narrative (
  ticker TEXT NOT NULL,
  pillar TEXT NOT NULL,
  score REAL NOT NULL,
  window TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ticker, pillar, window)
);

CREATE TABLE IF NOT EXISTS reactions (
  alert_id TEXT NOT NULL,
  offset TEXT NOT NULL,
  ticker TEXT,
  ticker_price REAL,
  sector TEXT,
  sector_price REAL,
  ts TEXT NOT NULL,
  PRIMARY KEY (alert_id, offset)
);

CREATE TABLE IF NOT EXISTS wsb_mentions (
  ticker TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ticker, captured_at)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function getMeta(key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function json<T>(value: T): string {
  return JSON.stringify(value);
}

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function readJsonFile<T>(rel: string): T {
  const p = path.join(ROOT, "data", rel);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}
