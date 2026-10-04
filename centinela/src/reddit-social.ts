import { createHash } from "node:crypto";
import { db, nowIso, readJsonFile } from "./db.ts";
import { isMegaCap, lexiconPolarity } from "./entities.ts";
import { extractSocialTickers, pickCommentTicker } from "./ticker-filter.ts";
import { MARKET_TZ } from "./config.ts";
import { appSettings, blockPhrases } from "./settings.ts";
import type { TickerPace } from "./types.ts";

/**
 * Recolección social (G3): cuenta y guarda. No clasifica sarcasmo ni “inteligencia”.
 *
 * 1. Ticker en alza (emerging) — pico vs su media 7d, no vs NVDA/SPY.
 * 2. Staples — siempre en palestra; se cuentan aparte.
 * 3. Comentarios únicos vs copypasta.
 * 4. Flag barato: ok | short | deleted | automod | copypasta.
 * 5. Score Reddit + recorte del body (agente futuro).
 * 6. Cruce entre subs.
 * 7. Hilo daily (título, weekday vs weekend).
 */

export type RedditSubConfig = {
  wsb: string;
  dailyTitleIncludes: string[];
  subs: string[];
  hotPostsPerSub: number;
  commentsPerPost: number;
  commentsDaily: number;
};

export type CheapFlag = "ok" | "short" | "deleted" | "automod" | "copypasta";

export type TickerHit = {
  ticker: string;
  role: "emerging" | "staple";
  comments: number;
  variants: number;
  cheapOk: number;
  ratio7d: number | null;
  subs: string[];
};

export type CommentQuote = {
  ticker: string;
  body: string;
  score: number;
  flag: string;
  sub: string;
  created?: string;
};

export type SocialRun = {
  source: "wsb_daily" | "subs";
  comments: number;
  threadTitle: string | null;
  threadKind: "daily" | "weekend" | "unknown";
  schedule: string;
  emerging: TickerHit[];
  emergingBySub: { sub: string; tickers: TickerHit[] }[];
  staples: TickerHit[];
  tickers: TickerHit[];
  quotes: CommentQuote[];
  sentiment: {
    bull: number;
    bear: number;
    unlabeled: number;
    pct_bull: number;
    pct_bear: number;
    pct_flat: number;
    bar_bull: string;
    bar_bear: string;
    bar_flat: string;
    note: string;
  };
  windowHours: number;
  windowComments: number;
  tickers24h: TickerPace[];
  storage: { keepDays: number; comments: number; oldestNyDay: string | null };
  errors: string[];
};

type ListingChild = {
  kind?: string;
  data?: {
    id?: string;
    title?: string;
    body?: string;
    score?: number;
    created_utc?: number;
    author?: string;
    stickied?: boolean;
    replies?: Listing | string;
  };
};

type Listing = { data?: { children?: ListingChild[] } };

const ALWAYS_ON = new Set([
  "NVDA",
  "MSFT",
  "AAPL",
  "GOOG",
  "GOOGL",
  "AMZN",
  "META",
  "TSLA",
  "AVGO",
  "BRK.B",
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "VOO",
  "VTI",
  "TLT",
  "GLD",
  "GME",
  "AMC",
]);

export const COMMENT_KEEP_DAYS = 31;

export const WSB_SCHEDULE =
  "Lun–vie: Daily Discussion ~6:00 AM ET (premarket, ~10:00 UTC). Viernes ~16:00 ET: Weekend Discussion. Sáb–dom permanece el weekend hasta el daily del lunes.";

let lastFetch = 0;

function nyParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TZ,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    day: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function nyDayFromCreated(createdUnix: number, fallbackIso: string): string {
  if (createdUnix > 0) return nyParts(new Date(createdUnix * 1000)).day;
  const t = Date.parse(fallbackIso);
  return nyParts(Number.isFinite(t) ? new Date(t) : new Date()).day;
}

function threadKindOf(title: string | null): SocialRun["threadKind"] {
  const t = (title ?? "").toLowerCase();
  if (t.includes("weekend")) return "weekend";
  if (t.includes("daily discussion")) return "daily";
  return "unknown";
}

function preferWsbThread(
  hot: { id?: string; title?: string; stickied?: boolean }[],
  keys: string[],
): { id?: string; title?: string; stickied?: boolean } | undefined {
  const { weekday, hour } = nyParts();
  const weekendWindow = weekday === "Sat" || weekday === "Sun" || (weekday === "Fri" && hour >= 16);
  const want = weekendWindow ? "weekend discussion" : "daily discussion";
  return (
    hot.find((p) => (p.title ?? "").toLowerCase().includes(want)) ??
    hot.find((p) => keys.some((k) => (p.title ?? "").toLowerCase().includes(k))) ??
    hot.find((p) => p.stickied)
  );
}

function meter(pct: number): string {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `${"█".repeat(n)}${"░".repeat(10 - n)}`;
}

function sentimentBoard(bull: number, bear: number, unlabeled: number): SocialRun["sentiment"] {
  const tot = Math.max(1, bull + bear + unlabeled);
  const pct_bull = Math.round((bull / tot) * 100);
  const pct_bear = Math.round((bear / tot) * 100);
  const pct_flat = Math.max(0, 100 - pct_bull - pct_bear);
  return {
    bull,
    bear,
    unlabeled,
    pct_bull,
    pct_bear,
    pct_flat,
    bar_bull: meter(pct_bull),
    bar_bear: meter(pct_bear),
    bar_flat: meter(pct_flat),
    note: "Léxico de las últimas 24 h (no el archivo de 31 días). Palabras sueltas; no lee sarcasmo.",
  };
}

function storageStats(): SocialRun["storage"] {
  const row = db
    .prepare("SELECT COUNT(*) AS n, MIN(ny_day) AS oldest FROM reddit_comments")
    .get() as { n: number; oldest: string | null };
  return { keepDays: appSettings().reddit.keepDays, comments: row.n, oldestNyDay: row.oldest };
}

function cfg(): RedditSubConfig {
  const file = readJsonFile<RedditSubConfig>("reddit-subs.json");
  const s = appSettings().reddit;
  return {
    ...file,
    hotPostsPerSub: s.hotPostsPerSub,
    commentsPerPost: s.commentsPerPost,
    commentsDaily: s.commentsDaily,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function redditJson<T>(pathAndQuery: string): Promise<T> {
  const wait = 1100 - (Date.now() - lastFetch);
  if (wait > 0) await sleep(wait);
  const path = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : pathAndQuery.startsWith("/")
      ? pathAndQuery
      : `/${pathAndQuery}`;
  const urls = pathAndQuery.startsWith("http")
    ? [pathAndQuery]
    : [
        `https://www.reddit.com${path}`,
        `https://www.reddit.com${path.replace("/hot.json", "/hot/.json")}`,
      ];
  const agents = [
    `Centinela/1.2.4 (HAOS; +https://github.com/Nahte-entprs/market-sentinel)`,
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  ];
  let lastErr = "reddit: sin respuesta";
  for (const url of [...new Set(urls)]) {
    for (const ua of agents) {
      lastFetch = Date.now();
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": ua, Accept: "application/json" },
          signal: AbortSignal.timeout(18000),
          redirect: "follow",
        });
        if (!res.ok) {
          lastErr = `${res.status} ${url}`;
          continue;
        }
        const ctype = res.headers.get("content-type") || "";
        if (!ctype.includes("json") && !ctype.includes("javascript")) {
          lastErr = `no-json ${url}`;
          continue;
        }
        return (await res.json()) as T;
      } catch (e) {
        lastErr = `${(e as Error).message} ${url}`;
      }
    }
  }
  throw new Error(lastErr);
}

function cheapFlag(body: string, author: string): CheapFlag {
  const t = body.trim();
  if (!t || t === "[deleted]" || t === "[removed]") return "deleted";
  if (author === "AutoModerator") return "automod";
  if (t.length < 12) return "short";
  const letters = t.replace(/[^\p{L}\p{N}$]/gu, "");
  if (letters.length < 8) return "short";
  return "ok";
}

function bodyKey(body: string) {
  return createHash("sha1")
    .update(
      body
        .toLowerCase()
        .replace(/[^\p{L}\p{N}$]+/gu, " ")
        .trim()
        .slice(0, 280),
    )
    .digest("hex")
    .slice(0, 16);
}

export { extractSocialTickers } from "./ticker-filter.ts";

function roleOf(ticker: string): TickerHit["role"] {
  if (ALWAYS_ON.has(ticker) || isMegaCap(ticker)) return "staple";
  return "emerging";
}

function flattenComments(
  listing: Listing | undefined,
  cap: number,
): { id: string; body: string; score: number; author: string; created: number }[] {
  const out: { id: string; body: string; score: number; author: string; created: number }[] = [];
  const walk = (node: Listing | undefined) => {
    if (!node || out.length >= cap) return;
    for (const child of node.data?.children ?? []) {
      if (out.length >= cap) return;
      if (child.kind === "more") continue;
      const d = child.data;
      if (d?.body && d.id) {
        out.push({
          id: d.id,
          body: d.body,
          score: Number(d.score ?? 0),
          author: d.author ?? "",
          created: Number(d.created_utc ?? 0),
        });
      }
      if (d?.replies && typeof d.replies !== "string") walk(d.replies);
    }
  };
  walk(listing);
  return out;
}

async function fetchHot(sub: string, limit: number) {
  const j = await redditJson<Listing>(`/r/${sub}/hot.json?limit=${limit}&raw_json=1`);
  return (j.data?.children ?? []).map((c) => c.data).filter((d): d is NonNullable<typeof d> => Boolean(d?.id));
}

async function fetchComments(sub: string, id: string, limit: number, sort: "new" | "top") {
  const j = await redditJson<[Listing, Listing]>(`/r/${sub}/comments/${id}.json?limit=${limit}&sort=${sort}&raw_json=1`);
  return flattenComments(j[1], limit);
}

type RawCmt = { id?: string; body?: string; author?: string; score?: number; created_utc?: number };

async function fetchArchiveComments(sub: string, size: number): Promise<{ id: string; body: string; score: number; author: string; created: number }[]> {
  const n = Math.min(Math.max(size, 25), 100);
  const urls = [
    `https://api.pullpush.io/reddit/search/comment/?subreddit=${encodeURIComponent(sub)}&size=${n}&sort=desc`,
    `https://arctic-shift.photon-reddit.com/api/comments/search?subreddit=${encodeURIComponent(sub)}&limit=${n}`,
  ];
  let last = "archivo reddit vacío";
  for (const url of urls) {
    const wait = 800 - (Date.now() - lastFetch);
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Centinela/1.2.4 (+https://github.com/Nahte-entprs/market-sentinel)",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        last = `${res.status} ${url}`;
        continue;
      }
      const j = (await res.json()) as { data?: RawCmt[] } | RawCmt[];
      const rows = Array.isArray(j) ? j : j.data;
      if (!Array.isArray(rows) || !rows.length) {
        last = `empty ${url}`;
        continue;
      }
      return rows
        .map((o) => ({
          id: String(o.id ?? ""),
          body: String(o.body ?? ""),
          score: Number(o.score ?? 0),
          author: String(o.author ?? ""),
          created: Number(o.created_utc ?? 0),
        }))
        .filter((c) => c.id && c.body);
    } catch (e) {
      last = `${(e as Error).message} ${url}`;
    }
  }
  throw new Error(last);
}

function persistComment(row: {
  id: string;
  sub: string;
  threadId: string;
  kind: string;
  body: string;
  score: number;
  created: string;
  nyDay: string;
  flag: CheapFlag;
  tickers: string[];
  capturedAt: string;
}) {
  db.prepare(
    `INSERT INTO reddit_comments (id, sub, thread_id, kind, body, score, created_utc, cheap_flag, body_key, captured_at, ny_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       score=excluded.score,
       cheap_flag=excluded.cheap_flag,
       body=excluded.body,
       ny_day=excluded.ny_day`,
  ).run(
    row.id,
    row.sub,
    row.threadId,
    row.kind,
    row.body.slice(0, 800),
    row.score,
    row.created,
    row.flag,
    bodyKey(row.body),
    row.capturedAt,
    row.nyDay,
  );
  db.prepare("DELETE FROM reddit_comment_tickers WHERE comment_id = ?").run(row.id);
  const insT = db.prepare("INSERT OR IGNORE INTO reddit_comment_tickers (comment_id, ticker) VALUES (?, ?)");
  for (const t of row.tickers) insT.run(row.id, t);
}

function snapshotTickers(sub: string, ts: string): TickerHit[] {
  const rows = db
    .prepare(
      `SELECT t.ticker,
              COUNT(DISTINCT c.id) AS comments,
              COUNT(DISTINCT c.body_key) AS variants,
              SUM(CASE WHEN c.cheap_flag = 'ok' THEN 1 ELSE 0 END) AS cheap_ok
       FROM reddit_comment_tickers t
       JOIN reddit_comments c ON c.id = t.comment_id
       WHERE c.sub = ? AND c.captured_at = ?
       GROUP BY t.ticker`,
    )
    .all(sub, ts) as { ticker: string; comments: number; variants: number; cheap_ok: number }[];

  const ins = db.prepare(
    `INSERT OR REPLACE INTO reddit_ticker_snapshots (ticker, sub, captured_at, mention_comments, body_variants, cheap_ok)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const hits: TickerHit[] = [];
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  for (const r of rows) {
    ins.run(r.ticker, sub, ts, r.comments, r.variants, r.cheap_ok);
    const prev = db
      .prepare(
        `SELECT AVG(mention_comments) AS avg FROM reddit_ticker_snapshots
         WHERE ticker = ? AND sub = ? AND captured_at < ? AND captured_at >= ?`,
      )
      .get(r.ticker, sub, ts, weekAgo) as { avg: number | null };
    const avg = prev.avg ?? 0;
    const ratio = avg >= 0.5 ? r.comments / avg : r.comments >= 3 ? 99 : null;
    hits.push({
      ticker: r.ticker,
      role: roleOf(r.ticker),
      comments: r.comments,
      variants: r.variants,
      cheapOk: r.cheap_ok,
      ratio7d: ratio,
      subs: [sub],
    });
  }
  return hits;
}

function ingestList(
  sub: string,
  threadId: string,
  kind: string,
  comments: { id: string; body: string; score: number; author: string; created: number }[],
  ts: string,
) {
  const seenKey = new Map<string, number>();
  for (const c of comments) {
    const flag0 = cheapFlag(c.body, c.author);
    const key = bodyKey(c.body);
    const n = (seenKey.get(key) ?? 0) + 1;
    seenKey.set(key, n);
    const flag: CheapFlag = n > 1 ? "copypasta" : flag0;
    const tickers = flag === "deleted" || flag === "automod" ? [] : extractSocialTickers(c.body);
    persistComment({
      id: c.id,
      sub,
      threadId,
      kind,
      body: c.body,
      score: c.score,
      created: c.created ? new Date(c.created * 1000).toISOString() : ts,
      nyDay: nyDayFromCreated(c.created, ts),
      flag,
      tickers,
      capturedAt: ts,
    });
  }
}

export function mergeHits(groups: TickerHit[][]): TickerHit[] {
  const map = new Map<string, TickerHit>();
  for (const g of groups) {
    for (const h of g) {
      const cur = map.get(h.ticker);
      if (!cur) {
        map.set(h.ticker, { ...h, subs: [...h.subs] });
        continue;
      }
      cur.comments += h.comments;
      cur.variants += h.variants;
      cur.cheapOk += h.cheapOk;
      for (const s of h.subs) if (!cur.subs.includes(s)) cur.subs.push(s);
      if (h.ratio7d != null) cur.ratio7d = Math.max(cur.ratio7d ?? 0, h.ratio7d);
    }
  }
  return [...map.values()];
}

function rankEmerging(hits: TickerHit[]): TickerHit[] {
  return hits
    .filter((h) => h.role === "emerging")
    .filter((h) => h.variants >= 2 && h.comments >= 3)
    .filter((h) => (h.ratio7d ?? 0) >= 3 || (h.ratio7d === 99 && h.comments >= 4))
    .sort((a, b) => b.comments - a.comments || (b.ratio7d ?? 0) - (a.ratio7d ?? 0))
    .slice(0, 12);
}

function emergingBlocks(groups: { sub: string; hits: TickerHit[] }[]): { sub: string; tickers: TickerHit[] }[] {
  return groups
    .map((g) => ({ sub: g.sub, tickers: rankEmerging(g.hits) }))
    .filter((b) => b.tickers.length > 0);
}

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

export function paceTickers(subs: string[]): TickerPace[] {
  if (!subs.length) return [];
  const since24 = isoAgo(24 * 3600_000);
  const since1h = isoAgo(3600_000);
  const since3h = isoAgo(3 * 3600_000);
  const ph = subs.map(() => "?").join(",");
  const paceRows = db
    .prepare(
      `SELECT t.ticker AS ticker,
              COUNT(*) AS comments,
              SUM(CASE WHEN c.created_utc >= ? THEN 1 ELSE 0 END) AS last1h,
              SUM(CASE WHEN c.created_utc >= ? THEN 1 ELSE 0 END) AS last3h
       FROM reddit_comments c
       JOIN reddit_comment_tickers t ON t.comment_id = c.id
       WHERE c.created_utc >= ? AND c.sub IN (${ph})
         AND c.cheap_flag NOT IN ('deleted', 'automod')
       GROUP BY t.ticker
       HAVING comments >= 1`,
    )
    .all(since1h, since3h, since24, ...subs) as {
    ticker: string;
    comments: number;
    last1h: number;
    last3h: number;
  }[];
  const paceCfg = appSettings().reddit;
  return paceRows
    .map((r) => {
      const comments = Number(r.comments);
      const last1h = Number(r.last1h);
      const last3h = Number(r.last3h);
      const rest = Math.max(0, comments - last1h);
      const hourlyAvg = rest / 23;
      const velocity =
        hourlyAvg >= paceCfg.velocityQuietHour
          ? last1h / hourlyAvg
          : last1h >= paceCfg.velocityBurst1h
            ? 20
            : last1h;
      const spike = last1h >= paceCfg.spikeLast1h && velocity >= paceCfg.spikeVelocity;
      return { ticker: r.ticker, comments, last1h, last3h, velocity, spike };
    })
    .sort((a, b) => b.comments - a.comments || b.last1h - a.last1h)
    .slice(0, 120);
}

export function liveTickers(source: "wsb" | "subs"): TickerPace[] {
  const c = cfg();
  return paceTickers(source === "wsb" ? [c.wsb] : c.subs);
}

function board24h(
  subs: string[],
  preferTickers: string[],
): {
  quotes: CommentQuote[];
  sentiment: SocialRun["sentiment"];
  windowComments: number;
  tickers24h: TickerPace[];
} {
  const emptySent = sentimentBoard(0, 0, 0);
  if (!subs.length) {
    return { quotes: [], sentiment: emptySent, windowComments: 0, tickers24h: [] };
  }
  const since24 = isoAgo(24 * 3600_000);
  const since3h = isoAgo(3 * 3600_000);
  const ph = subs.map(() => "?").join(",");

  const windowComments = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reddit_comments WHERE created_utc >= ? AND sub IN (${ph}) AND cheap_flag = 'ok'`,
      )
      .get(since24, ...subs) as { n: number }
  ).n;

  const polarRows = db
    .prepare(
      `SELECT body FROM reddit_comments WHERE created_utc >= ? AND sub IN (${ph}) AND cheap_flag = 'ok'`,
    )
    .all(since24, ...subs) as { body: string }[];
  let bull = 0;
  let bear = 0;
  let unlabeled = 0;
  for (const r of polarRows) {
    const p = lexiconPolarity(r.body);
    if (p > 0) bull++;
    else if (p < 0) bear++;
    else unlabeled++;
  }

  const tickers24h = paceTickers(subs);

  const prefer = new Set(preferTickers.length ? preferTickers : tickers24h.slice(0, 10).map((t) => t.ticker));
  const quoteRows = db
    .prepare(
      `SELECT c.body, c.score, c.sub, c.created_utc,
              GROUP_CONCAT(t.ticker, ',') AS tickers
       FROM reddit_comments c
       JOIN reddit_comment_tickers t ON t.comment_id = c.id
       WHERE c.created_utc >= ? AND c.sub IN (${ph})
         AND c.cheap_flag = 'ok' AND length(c.body) >= 80
       GROUP BY c.id
       ORDER BY (CASE WHEN c.created_utc >= ? THEN 8 ELSE 0 END) + MIN(c.score, 40) DESC,
                length(c.body) DESC, c.created_utc DESC
       LIMIT 25`,
    )
    .all(since24, ...subs, since3h) as {
    body: string;
    score: number;
    sub: string;
    created_utc: string;
    tickers: string | null;
  }[];

  const quotes: CommentQuote[] = quoteRows.map((r) => ({
    ticker: pickCommentTicker(r.tickers, prefer),
    body: r.body.replace(/\s+/g, " ").slice(0, 420),
    score: r.score,
    flag: "ok",
    sub: r.sub,
  }));

  return {
    quotes,
    sentiment: sentimentBoard(bull, bear, unlabeled),
    windowComments,
    tickers24h,
  };
}

function likeNeedle(phrase: string): string {
  return `%${phrase.replace(/[%_]/g, "")}%`;
}

export function listWindowComments(source: "wsb" | "subs", ticker: string, offset: number) {
  const c = cfg();
  const subs = source === "wsb" ? [c.wsb] : c.subs;
  const s = appSettings().reddit;
  const limit = s.pageSize;
  const start = Math.max(0, Math.floor(offset) || 0);
  if (!subs.length) return { total: 0, offset: start, limit, comments: [] as CommentQuote[] };

  const since24 = isoAgo(24 * 3600_000);
  const phrases = blockPhrases(s.blockText);
  const ph = subs.map(() => "?").join(",");
  const phraseSql = phrases.map(() => "AND lower(c.body) NOT LIKE ?").join(" ");
  const maxSql = s.maxChars > 0 ? "AND length(c.body) <= ?" : "";
  const symbol = ticker.trim().toUpperCase();
  const tickerSql = symbol
    ? "AND EXISTS (SELECT 1 FROM reddit_comment_tickers t WHERE t.comment_id = c.id AND t.ticker = ?)"
    : "AND NOT EXISTS (SELECT 1 FROM reddit_comment_tickers t WHERE t.comment_id = c.id)";
  const where = `c.created_utc >= ? AND c.sub IN (${ph}) AND c.cheap_flag = 'ok' AND length(c.body) >= ? ${maxSql} ${phraseSql} ${tickerSql}`;
  const args: (string | number)[] = [since24, ...subs, s.minChars];
  if (s.maxChars > 0) args.push(s.maxChars);
  for (const p of phrases) args.push(likeNeedle(p));
  if (symbol) args.push(symbol);

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM reddit_comments c WHERE ${where}`).get(...args) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `SELECT c.body, c.score, c.sub, c.created_utc
       FROM reddit_comments c
       WHERE ${where}
       ORDER BY c.created_utc DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, start) as { body: string; score: number; sub: string; created_utc: string }[];

  return {
    total,
    offset: start,
    limit,
    comments: rows.map((r) => ({
      ticker: symbol || "",
      body: r.body.replace(/\s+/g, " ").trim(),
      score: r.score,
      flag: "ok",
      sub: r.sub,
      created: r.created_utc,
    })),
  };
}

function prune() {
  const cut = new Date(Date.now() - appSettings().reddit.keepDays * 86400_000).toISOString();
  db.prepare("DELETE FROM reddit_comments WHERE created_utc < ?").run(cut);
  db.prepare("DELETE FROM reddit_ticker_snapshots WHERE captured_at < ?").run(cut);
  db.prepare("DELETE FROM reddit_comment_tickers WHERE comment_id NOT IN (SELECT id FROM reddit_comments)").run();
}

function columnNames(table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

function backfillNyDay() {
  const rows = db.prepare("SELECT id, created_utc FROM reddit_comments WHERE ny_day IS NULL OR ny_day = ''").all() as {
    id: string;
    created_utc: string;
  }[];
  if (!rows.length) return;
  const upd = db.prepare("UPDATE reddit_comments SET ny_day = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const r of rows) upd.run(nyDayFromCreated(0, r.created_utc), r.id);
  });
  tx();
}

export function ensureRedditTables() {
  db.exec(`
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
  captured_at TEXT NOT NULL
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
  if (!columnNames("reddit_comments").has("ny_day")) {
    db.exec("ALTER TABLE reddit_comments ADD COLUMN ny_day TEXT NOT NULL DEFAULT ''");
  }
  backfillNyDay();
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_reddit_comments_ny_day ON reddit_comments(ny_day);
CREATE INDEX IF NOT EXISTS idx_reddit_comments_created ON reddit_comments(created_utc);
`);
}

export async function collectWsbDaily(): Promise<SocialRun> {
  const c = cfg();
  const errors: string[] = [];
  const ts = nowIso();
  let threadTitle: string | null = null;
  let comments: Awaited<ReturnType<typeof fetchComments>> = [];
  let threadId = "";
  try {
    const hot = await fetchHot(c.wsb, 20);
    const daily = preferWsbThread(hot, c.dailyTitleIncludes);
    if (!daily?.id) throw new Error("no daily/weekend thread");
    threadId = daily.id;
    threadTitle = daily.title ?? null;
    comments = await fetchComments(c.wsb, daily.id, c.commentsDaily, "new");
  } catch (e) {
    errors.push(`json: ${(e as Error).message}`.slice(0, 160));
  }
  if (!comments.length) {
    try {
      comments = await fetchArchiveComments(c.wsb, c.commentsDaily);
      threadId = threadId || "archive";
      threadTitle = threadTitle || "r/wallstreetbets recientes (archivo; Reddit JSON bloqueado)";
    } catch (e) {
      errors.push(`archivo: ${(e as Error).message}`.slice(0, 160));
    }
  }
  ingestList(c.wsb, threadId || "none", "daily", comments, ts);
  const hits = threadId ? snapshotTickers(c.wsb, ts) : [];
  const insW = db.prepare("INSERT OR REPLACE INTO wsb_mentions (ticker, captured_at, count) VALUES (?, ?, ?)");
  for (const h of hits) insW.run(h.ticker, ts, h.comments);
  const em = rankEmerging(hits);
  const board = board24h(
    [c.wsb],
    em.map((h) => h.ticker),
  );
  prune();
  return {
    source: "wsb_daily",
    comments: comments.length,
    threadTitle,
    threadKind: threadKindOf(threadTitle),
    schedule: WSB_SCHEDULE,
    emerging: em,
    emergingBySub: emergingBlocks([{ sub: c.wsb, hits }]),
    staples: hits.filter((h) => h.role === "staple").sort((a, b) => b.comments - a.comments).slice(0, 8),
    tickers: em,
    quotes: board.quotes,
    sentiment: board.sentiment,
    windowHours: 24,
    windowComments: board.windowComments,
    tickers24h: board.tickers24h,
    storage: storageStats(),
    errors,
  };
}

export async function collectOtherSubs(): Promise<SocialRun> {
  const c = cfg();
  const errors: string[] = [];
  const ts = nowIso();
  let nComments = 0;
  const perSub: { sub: string; hits: TickerHit[] }[] = [];
  for (const sub of c.subs) {
    try {
      let n = 0;
      try {
        const hot = await fetchHot(sub, 12);
        const posts = hot.filter((p) => !p.stickied).slice(0, c.hotPostsPerSub);
        for (const p of posts) {
          if (!p.id) continue;
          const comments = await fetchComments(sub, p.id, c.commentsPerPost, "new");
          n += comments.length;
          ingestList(sub, p.id, "post", comments, ts);
        }
      } catch {
        const comments = await fetchArchiveComments(sub, c.commentsPerPost * c.hotPostsPerSub);
        n = comments.length;
        ingestList(sub, "archive", "post", comments, ts);
      }
      nComments += n;
      perSub.push({ sub, hits: snapshotTickers(sub, ts) });
    } catch (e) {
      errors.push(`${sub}: ${(e as Error).message}`.slice(0, 120));
    }
  }
  const hits = mergeHits(perSub.map((p) => p.hits));
  const bySub = emergingBlocks(perSub);
  const em = rankEmerging(hits);
  const board = board24h(
    c.subs,
    em.map((h) => h.ticker),
  );
  prune();
  return {
    source: "subs",
    comments: nComments,
    threadTitle: c.subs.join(", "),
    threadKind: "unknown",
    schedule: WSB_SCHEDULE,
    emerging: em,
    emergingBySub: bySub,
    staples: [],
    tickers: bySub.flatMap((b) => b.tickers),
    quotes: board.quotes,
    sentiment: board.sentiment,
    windowHours: 24,
    windowComments: board.windowComments,
    tickers24h: board.tickers24h,
    storage: storageStats(),
    errors,
  };
}
