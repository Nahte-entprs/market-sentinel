import { db, json, nowIso, getMeta, setMeta, readJsonFile } from "./db.ts";

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
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO job_runs (job_id, last_status) VALUES (?, 'idle')`);
  for (const id of jobs) ins.run(id);
}

export function listTickers(kind?: string) {
  if (kind) {
    return db
      .prepare("SELECT symbol, name, sector, kind, enabled FROM tickers WHERE kind = ? AND enabled = 1 ORDER BY symbol")
      .all(kind) as { symbol: string; name: string; sector: string; kind: string; enabled: number }[];
  }
  return db
    .prepare("SELECT symbol, name, sector, kind, enabled FROM tickers WHERE enabled = 1 ORDER BY kind, symbol")
    .all() as { symbol: string; name: string; sector: string; kind: string; enabled: number }[];
}

export function addTicker(symbol: string, name?: string, sector = "ai") {
  const s = symbol.trim().toUpperCase();
  if (!/^[A-Z.]{1,8}$/.test(s.replace("=", ""))) {
    throw new Error("Símbolo inválido");
  }
  db.prepare(
    `INSERT INTO tickers (symbol, name, sector, kind, enabled, added_at) VALUES (?, ?, ?, 'ticker', 1, ?)
     ON CONFLICT(symbol) DO UPDATE SET enabled = 1, name = excluded.name`,
  ).run(s, name || s, sector, nowIso());
  return s;
}

export function removeTicker(symbol: string) {
  db.prepare("UPDATE tickers SET enabled = 0 WHERE symbol = ?").run(symbol.toUpperCase());
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
