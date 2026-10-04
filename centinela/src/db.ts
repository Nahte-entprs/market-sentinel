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
  added_at TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'watchlist',
  invested_usd REAL NOT NULL DEFAULT 0,
  fair_price REAL,
  sort_order INTEGER NOT NULL DEFAULT 0
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
  ts TEXT NOT NULL,
  ma50 REAL,
  ma100 REAL,
  ma200 REAL,
  target_mean REAL,
  rec_mean REAL,
  rec_key TEXT,
  analyst_count INTEGER,
  week52_high REAL,
  week52_low REAL
);

CREATE TABLE IF NOT EXISTS quote_bars (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  volume INTEGER NOT NULL,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS quote_intraday (
  symbol TEXT NOT NULL,
  ts TEXT NOT NULL,
  close REAL NOT NULL,
  volume INTEGER NOT NULL,
  PRIMARY KEY (symbol, ts)
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

CREATE TABLE IF NOT EXISTS reddit_comments (
  id TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_utc TEXT NOT NULL,
  cheap_flag TEXT NOT NULL,
  body_key TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  ny_day TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reddit_comment_tickers (
  comment_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  PRIMARY KEY (comment_id, ticker)
);
CREATE TABLE IF NOT EXISTS reddit_ticker_snapshots (
  ticker TEXT NOT NULL,
  sub TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  mention_comments INTEGER NOT NULL,
  body_variants INTEGER NOT NULL,
  cheap_ok INTEGER NOT NULL,
  PRIMARY KEY (ticker, sub, captured_at)
);
`);

function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn("tickers", "category", "category TEXT NOT NULL DEFAULT 'watchlist'");
ensureColumn("tickers", "invested_usd", "invested_usd REAL NOT NULL DEFAULT 0");
ensureColumn("tickers", "fair_price", "fair_price REAL");
ensureColumn("tickers", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0");
ensureColumn("quotes", "ma50", "ma50 REAL");
ensureColumn("quotes", "ma100", "ma100 REAL");
ensureColumn("quotes", "ma200", "ma200 REAL");
ensureColumn("quotes", "target_mean", "target_mean REAL");
ensureColumn("quotes", "rec_mean", "rec_mean REAL");
ensureColumn("quotes", "rec_key", "rec_key TEXT");
ensureColumn("quotes", "analyst_count", "analyst_count INTEGER");
ensureColumn("quotes", "week52_high", "week52_high REAL");
ensureColumn("quotes", "week52_low", "week52_low REAL");
ensureColumn("reddit_comments", "author", "author TEXT NOT NULL DEFAULT ''");
ensureColumn("reddit_comments", "author_flair", "author_flair TEXT NOT NULL DEFAULT ''");
ensureColumn("reddit_comments", "post_title", "post_title TEXT NOT NULL DEFAULT ''");

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

if (getMeta("cartera_v1") !== "1") {
  const cats = ["holding", "priority", "watchlist"];
  for (const cat of cats) {
    const rows = db
      .prepare("SELECT symbol FROM tickers WHERE kind = 'ticker' AND category = ? ORDER BY symbol")
      .all(cat) as { symbol: string }[];
    const upd = db.prepare("UPDATE tickers SET sort_order = ? WHERE symbol = ?");
    rows.forEach((r, i) => upd.run(i + 1, r.symbol));
  }
  setMeta("cartera_v1", "1");
}
