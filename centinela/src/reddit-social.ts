import { createHash } from "node:crypto";
import { db, nowIso, readJsonFile } from "./db.ts";
import { extractCashtags, isMegaCap, lexiconPolarity } from "./entities.ts";

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
};

export type SocialRun = {
  source: "wsb_daily" | "subs";
  comments: number;
  threadTitle: string | null;
  emerging: TickerHit[];
  staples: TickerHit[];
  tickers: TickerHit[];
  quotes: CommentQuote[];
  sentiment: { bull: number; bear: number; unlabeled: number; note: string };
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

const STOP = new Set(
  `THE AND FOR ARE BUT NOT YOU ALL CAN HER WAS ONE OUR OUT DAY GET HAS HIM HIS HOW ITS MAY NEW NOW OLD SEE TWO WAY WHO BOY DID LET PUT SAY SHE TOO USE CEO IPO ETF SEC FED GDP ATH IMO NFA EOD PTA YOLO HOLD HODL THIS THAT JUST FROM WITH YOUR HAVE WILL BEAT MISS CALL PUTS CALLS MOON TEND WSB DD AI USA USD OTC RN EDIT OP OK LOL OMG WTF RIP ASAP IIRC TBH FOMO RSI MACD EPS PE AM IS TO IN ON OF AT BY AS OR IF IT WE HE SO NO UP GOOD BEST SELL BUY LONG SHORT BULL BEAR PUMP DUMP NEXT WEEK OVER INTO THEY THEM WHAT WHEN THEN THAN ALSO VERY MUCH MORE MOST SOME ANY`
    .split(/\s+/)
    .filter(Boolean),
);

let lastFetch = 0;

function cfg(): RedditSubConfig {
  return readJsonFile<RedditSubConfig>("reddit-subs.json");
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
    `Centinela/1.2.2 (HAOS; +https://github.com/Nahte-entprs/market-sentinel)`,
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

export function extractSocialTickers(text: string): string[] {
  const found = new Set<string>();
  for (const s of extractCashtags(text)) {
    if (s.length >= 2 && s.length <= 5) found.add(s);
  }
  for (const m of text.toUpperCase().matchAll(/\b[A-Z]{2,5}\b/g)) {
    const s = m[0];
    if (STOP.has(s)) continue;
    found.add(s);
  }
  return [...found];
}

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
          "User-Agent": "Centinela/1.2.2 (+https://github.com/Nahte-entprs/market-sentinel)",
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
  flag: CheapFlag;
  tickers: string[];
  capturedAt: string;
}) {
  db.prepare(
    `INSERT INTO reddit_comments (id, sub, thread_id, kind, body, score, created_utc, cheap_flag, body_key, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET score=excluded.score, cheap_flag=excluded.cheap_flag, captured_at=excluded.captured_at, body=excluded.body`,
  ).run(
    row.id,
    row.sub,
    row.threadId,
    row.kind,
    row.body.slice(0, 500),
    row.score,
    row.created,
    row.flag,
    bodyKey(row.body),
    row.capturedAt,
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

function boardFromDb(ts: string, subs: string[]): { tickers: TickerHit[]; quotes: CommentQuote[]; sentiment: SocialRun["sentiment"] } {
  const placeholders = subs.map(() => "?").join(",");
  const quoteRows = db
    .prepare(
      `SELECT c.id, c.body, c.score, c.cheap_flag, c.sub,
              GROUP_CONCAT(t.ticker, ',') AS tickers
       FROM reddit_comments c
       LEFT JOIN reddit_comment_tickers t ON t.comment_id = c.id
       WHERE c.captured_at = ? AND c.sub IN (${placeholders})
         AND c.cheap_flag = 'ok' AND length(c.body) >= 40
       GROUP BY c.id
       ORDER BY c.score DESC
       LIMIT 12`,
    )
    .all(ts, ...subs) as { id: string; body: string; score: number; cheap_flag: string; sub: string; tickers: string | null }[];

  const quotes: CommentQuote[] = quoteRows.map((r) => ({
    ticker: (r.tickers || "—").split(",")[0] || "—",
    body: r.body.replace(/\s+/g, " ").slice(0, 280),
    score: r.score,
    flag: r.cheap_flag,
    sub: r.sub,
  }));

  const polarRows = db
    .prepare(
      `SELECT body FROM reddit_comments
       WHERE captured_at = ? AND sub IN (${placeholders}) AND cheap_flag = 'ok'`,
    )
    .all(ts, ...subs) as { body: string }[];
  let bull = 0;
  let bear = 0;
  let unlabeled = 0;
  for (const r of polarRows) {
    const p = lexiconPolarity(r.body);
    if (p > 0) bull++;
    else if (p < 0) bear++;
    else unlabeled++;
  }
  return {
    tickers: [],
    quotes,
    sentiment: {
      bull,
      bear,
      unlabeled,
      note: "Léxico grosero (moon/puts). No detecta sarcasmo; el agente futuro lo sustituye.",
    },
  };
}

function prune() {
  const cut = new Date(Date.now() - 14 * 86400_000).toISOString();
  db.prepare("DELETE FROM reddit_comments WHERE captured_at < ?").run(cut);
  db.prepare("DELETE FROM reddit_ticker_snapshots WHERE captured_at < ?").run(cut);
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
    const daily =
      hot.find((p) => {
        const t = (p.title ?? "").toLowerCase();
        return c.dailyTitleIncludes.some((k) => t.includes(k));
      }) ?? hot.find((p) => p.stickied);
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
  const board = boardFromDb(ts, [c.wsb]);
  prune();
  return {
    source: "wsb_daily",
    comments: comments.length,
    threadTitle,
    emerging: rankEmerging(hits),
    staples: hits.filter((h) => h.role === "staple").sort((a, b) => b.comments - a.comments).slice(0, 8),
    tickers: [...hits].sort((a, b) => b.comments - a.comments).slice(0, 25),
    quotes: board.quotes,
    sentiment: board.sentiment,
    errors,
  };
}

export async function collectOtherSubs(): Promise<SocialRun> {
  const c = cfg();
  const errors: string[] = [];
  const ts = nowIso();
  let nComments = 0;
  const groups: TickerHit[][] = [];
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
      groups.push(snapshotTickers(sub, ts));
    } catch (e) {
      errors.push(`${sub}: ${(e as Error).message}`.slice(0, 120));
    }
  }
  const hits = mergeHits(groups);
  const board = boardFromDb(ts, c.subs);
  prune();
  return {
    source: "subs",
    comments: nComments,
    threadTitle: c.subs.join(", "),
    emerging: rankEmerging(hits),
    staples: hits.filter((h) => h.role === "staple").sort((a, b) => b.comments - a.comments).slice(0, 8),
    tickers: [...hits].sort((a, b) => b.comments - a.comments).slice(0, 25),
    quotes: board.quotes,
    sentiment: board.sentiment,
    errors,
  };
}
