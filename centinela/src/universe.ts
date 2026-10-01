import { db, json, nowIso, getMeta, setMeta, readJsonFile } from "./db.ts";
import type { TickerCategory } from "./types.ts";

export type TickerRow = {
  symbol: string;
  name: string;
  sector: string;
  kind: string;
  enabled: number;
  category: TickerCategory;
  invested_usd: number;
  fair_price: number | null;
  sort_order: number;
};

const CATEGORIES = new Set<TickerCategory>(["holding", "priority", "watchlist"]);

function mapTicker(r: Record<string, unknown>): TickerRow {
  const cat = String(r.category ?? "watchlist");
  return {
    symbol: String(r.symbol),
    name: String(r.name),
    sector: String(r.sector),
    kind: String(r.kind),
    enabled: Number(r.enabled),
    category: CATEGORIES.has(cat as TickerCategory) ? (cat as TickerCategory) : "watchlist",
    invested_usd: Number(r.invested_usd ?? 0),
    fair_price: r.fair_price == null ? null : Number(r.fair_price),
    sort_order: Number(r.sort_order ?? 0),
  };
}

export function parseCategory(raw: string | undefined | null): TickerCategory {
  const c = (raw || "").trim().toLowerCase() as TickerCategory;
  return CATEGORIES.has(c) ? c : "watchlist";
}

type UniverseFile = {
  tickers: { symbol: string; name: string; sector: string }[];
  etfs: { symbol: string; name: string; sector: string }[];
  sectors: { id: string; label: string; etf: string }[];
  factors: { id: string; label: string; keywords: string[]; elevated?: number }[];
  ideas: { id: string; title: string; claim: string; factorId: string; verdict: string }[];
};

export function seedIfNeeded() {
  if (getMeta("seeded") === "1") {
    ensureJobRows();
    return;
  }
  const u = readJsonFile<UniverseFile>("universe.json");
  const insertTicker = db.prepare(
    `INSERT OR IGNORE INTO tickers (symbol, name, sector, kind, enabled, added_at) VALUES (?, ?, ?, ?, 1, ?)`,
  );
  const ts = nowIso();
  for (const t of u.tickers) insertTicker.run(t.symbol, t.name, t.sector, "ticker", ts);
  for (const t of u.etfs) insertTicker.run(t.symbol, t.name, t.sector, "etf", ts);

  const insertSector = db.prepare(`INSERT OR IGNORE INTO sectors (id, label, etf, elevated) VALUES (?, ?, ?, 0)`);
  for (const s of u.sectors) insertSector.run(s.id, s.label, s.etf);

  const insertFactor = db.prepare(
    `INSERT OR IGNORE INTO factors (id, label, keywords, elevated) VALUES (?, ?, ?, ?)`,
  );
  for (const f of u.factors) insertFactor.run(f.id, f.label, json(f.keywords), f.elevated ? 1 : 0);

  const insertIdea = db.prepare(
    `INSERT OR IGNORE INTO ideas (id, title, claim, factor_id, verdict, evidence, updated_at) VALUES (?, ?, ?, ?, ?, '[]', ?)`,
  );
  for (const i of u.ideas) insertIdea.run(i.id, i.title, i.claim, i.factorId, i.verdict, ts);

  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('regime', 'NORMAL')`).run();
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('digest_hours', '2')`).run();
  ensureJobRows();
  setMeta("seeded", "1");
}

function ensureJobRows() {
  const jobs = [
    "quotes.poll",
    "macro.scan",
    "ticker.events",
    "market.sentiment",
    "volume.unusual",
    "reddit.rising",
    "reddit.subs",
    "regime.tick",
    "digest.brief",
    "reaction.snap",
    "ideas.eval",
    "fundamentals.poll",
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO job_runs (job_id, last_status) VALUES (?, 'idle')`);
  for (const id of jobs) ins.run(id);
}

const TICKER_COLS =
  "symbol, name, sector, kind, enabled, category, invested_usd, fair_price, sort_order";

export function listTickers(kind?: string): TickerRow[] {
  if (kind) {
    return (db.prepare(`SELECT ${TICKER_COLS} FROM tickers WHERE kind = ? AND enabled = 1 ORDER BY symbol`).all(kind) as Record<string, unknown>[]).map(mapTicker);
  }
  return (db.prepare(`SELECT ${TICKER_COLS} FROM tickers WHERE enabled = 1 ORDER BY kind, symbol`).all() as Record<string, unknown>[]).map(mapTicker);
}

export function listTickersByCategory(category: TickerCategory): TickerRow[] {
  const rows = (
    db
      .prepare(`SELECT ${TICKER_COLS} FROM tickers WHERE kind = 'ticker' AND enabled = 1 AND category = ?`)
      .all(category) as Record<string, unknown>[]
  ).map(mapTicker);
  if (category === "holding") {
    return rows.sort((a, b) => b.invested_usd - a.invested_usd || a.symbol.localeCompare(b.symbol));
  }
  return rows.sort((a, b) => a.sort_order - b.sort_order || a.symbol.localeCompare(b.symbol));
}

export function getTicker(symbol: string): TickerRow | null {
  const s = symbol.trim().toUpperCase();
  if (!s) return null;
  const r = db.prepare(`SELECT ${TICKER_COLS} FROM tickers WHERE symbol = ?`).get(s) as Record<string, unknown> | undefined;
  return r ? mapTicker(r) : null;
}

function normalizeSymbol(symbol: string) {
  const s = symbol.trim().toUpperCase();
  if (!/^[A-Z.]{1,8}$/.test(s.replace("=", ""))) {
    throw new Error("Símbolo inválido");
  }
  return s;
}

function nextSortOrder(category: TickerCategory) {
  const row = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM tickers WHERE kind = 'ticker' AND category = ? AND enabled = 1")
    .get(category) as { m: number };
  return Number(row?.m ?? 0) + 1;
}

export function addTicker(symbol: string, name?: string, sector = "ai") {
  return upsertTicker({ symbol, name, sector, category: "watchlist" });
}

export function upsertTicker(opts: {
  symbol: string;
  name?: string;
  sector?: string;
  category?: TickerCategory | string;
  investedUsd?: number;
  fairPrice?: number | null;
}) {
  const s = normalizeSymbol(opts.symbol);
  const existing = getTicker(s);
  const category = parseCategory(opts.category ?? existing?.category);
  const invested =
    opts.investedUsd != null && Number.isFinite(opts.investedUsd) ? Math.max(0, opts.investedUsd) : (existing?.invested_usd ?? 0);
  let fair: number | null;
  if (opts.fairPrice === undefined) {
    fair = existing?.fair_price ?? null;
  } else if (!existing) {
    fair = opts.fairPrice && opts.fairPrice > 0 ? opts.fairPrice : null;
  } else if (opts.fairPrice != null && opts.fairPrice > 0) {
    fair = opts.fairPrice;
  } else {
    fair = existing.fair_price;
  }
  const name = opts.name || existing?.name || s;
  const sector = opts.sector || existing?.sector || "ai";
  const categoryChanged = !existing || existing.category !== category || existing.enabled === 0;
  const sort = categoryChanged ? nextSortOrder(category) : existing.sort_order;

  db.prepare(
    `INSERT INTO tickers (symbol, name, sector, kind, enabled, added_at, category, invested_usd, fair_price, sort_order)
     VALUES (?, ?, ?, 'ticker', 1, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       enabled = 1,
       name = excluded.name,
       sector = excluded.sector,
       category = excluded.category,
       invested_usd = excluded.invested_usd,
       fair_price = excluded.fair_price,
       sort_order = excluded.sort_order`,
  ).run(s, name, sector, nowIso(), category, invested, fair, sort);
  return s;
}

export function removeTicker(symbol: string) {
  db.prepare("UPDATE tickers SET enabled = 0 WHERE symbol = ?").run(symbol.trim().toUpperCase());
}

export function moveTicker(symbol: string, dir: "up" | "down") {
  const s = normalizeSymbol(symbol);
  const current = getTicker(s);
  if (!current || current.enabled !== 1) throw new Error("Ticker no está en cartera");
  if (current.category === "holding") return s;
  const list = listTickersByCategory(current.category);
  const idx = list.findIndex((t) => t.symbol === s);
  if (idx < 0) return s;
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) return s;
  const other = list[swapWith];
  const upd = db.prepare("UPDATE tickers SET sort_order = ? WHERE symbol = ?");
  upd.run(other.sort_order, current.symbol);
  upd.run(current.sort_order, other.symbol);
  return s;
}

export function listFactors() {
  return db.prepare("SELECT id, label, keywords, elevated FROM factors ORDER BY label").all() as {
    id: string;
    label: string;
    keywords: string;
    elevated: number;
  }[];
}

export function listSectors() {
  return db.prepare("SELECT id, label, etf, elevated FROM sectors ORDER BY label").all() as {
    id: string;
    label: string;
    etf: string;
    elevated: number;
  }[];
}

export function addIdea(title: string, claim: string, factorId: string) {
  const id = `idea_${Date.now().toString(36)}`;
  db.prepare(
    `INSERT INTO ideas (id, title, claim, factor_id, verdict, evidence, updated_at) VALUES (?, ?, ?, ?, 'open', '[]', ?)`,
  ).run(id, title.trim().slice(0, 80), claim.trim().slice(0, 255), factorId, nowIso());
  db.prepare("UPDATE factors SET elevated = 1 WHERE id = ?").run(factorId);
  return id;
}

export function listIdeas() {
  return db.prepare("SELECT * FROM ideas ORDER BY updated_at DESC").all() as {
    id: string;
    title: string;
    claim: string;
    factor_id: string;
    verdict: string;
    evidence: string;
    updated_at: string;
  }[];
}
