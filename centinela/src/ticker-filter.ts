import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.ts";

type UniverseFile = {
  us: string[];
  extra: string[];
  strict: string[];
};

/** Palabras inglesas frecuentes que coinciden con tickers reales (OPEN, WELL…) o basura. */
const ENGLISH = new Set(
  `THE AND FOR ARE BUT NOT YOU ALL CAN HER WAS ONE OUR OUT DAY GET HAS HIM HIS HOW ITS MAY NEW NOW OLD SEE TWO WAY WHO BOY DID LET PUT SAY SHE TOO USE CEO IPO ETF SEC FED GDP ATH IMO NFA EOD PTA YOLO HOLD HODL THIS THAT JUST FROM WITH YOUR HAVE WILL BEAT MISS CALL PUTS CALLS MOON TEND WSB DD AI USA USD OTC RN EDIT OP OK LOL OMG WTF RIP ASAP IIRC TBH FOMO RSI MACD EPS PE AM IS TO IN ON OF AT BY AS OR IF IT WE HE SO NO UP GOOD BEST SELL BUY LONG SHORT BULL BEAR PUMP DUMP NEXT WEEK OVER INTO THEY THEM WHAT WHEN THEN THAN ALSO VERY MUCH MORE MOST SOME ANY LIKE ABOUT THERE THEIR WHERE WHICH WHILE COULD WOULD SHOULD THINK STILL NEVER ONLY YEAH MAYBE OKAY DOWN BROKE DONE BOTH AGREE DEAD BAD OPEN WELL REAL LOVE HOPE PLAY MOVE PLUS CARE LIFE CASH TECH DATA GOLD BOND FUND MASS UNIT BOLD SAFE FAST SHIP ROCK TREE WIND FIRE SNOW BLUE GRAY PINK MARK BILL JACK RIDE GROW GAIN FLOW TURN KEEP TIME WHY AN DO ME GO RE MY`
    .split(/\s+/)
    .filter(Boolean),
);

let listed: Set<string> | null = null;
let extra: Set<string> | null = null;
let extraBare: Map<string, string> | null = null;
let aliasCache: Record<string, string[]> | null = null;

function extractCashtags(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) found.add(m[1].toUpperCase());
  return [...found];
}

function readData<T>(rel: string): T {
  const p = path.join(ROOT, "data", rel);
  if (!fs.existsSync(p)) throw new Error(`falta ${rel} en el add-on`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function load() {
  if (listed) return;
  const file = readData<UniverseFile>("ticker-universe.json");
  listed = new Set();
  for (const raw of file.us ?? []) {
    const s = String(raw).trim().toUpperCase();
    if (/^[A-Z]{1,5}$/.test(s)) listed.add(s);
  }
  extra = new Set((file.extra ?? []).map((s) => s.trim().toUpperCase()));
  extraBare = new Map();
  for (const ex of extra) {
    if (ex.startsWith("^")) extraBare.set(ex.slice(1), ex);
  }
  for (const s of file.strict ?? []) ENGLISH.add(s.toUpperCase());
}

function aliases(): Record<string, string[]> {
  if (!aliasCache) aliasCache = readData<Record<string, string[]>>("ticker-aliases.json");
  return aliasCache;
}

function hasAlias(text: string, names: string[]): boolean {
  const n = text.toLowerCase();
  return names.some((name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}\\b`, "i").test(n);
  });
}

export function isListedTicker(sym: string): boolean {
  load();
  const s = sym.trim().toUpperCase();
  return listed!.has(s) || extra!.has(s);
}

/** Cashtag ($BE) o alias (Bloom) siempre. 2 letras y palabras inglesas no entran por gritar BE/OPEN. BE en mayúsculas sí. */
export function extractSocialTickers(text: string): string[] {
  load();
  const found = new Set<string>();

  for (const s of extractCashtags(text)) {
    if (listed!.has(s) || extra!.has(s)) found.add(s);
  }

  const upper = text.toUpperCase();
  for (const ex of extra!) {
    if (upper.includes(ex)) found.add(ex);
  }
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) {
    const bare = extraBare!.get(m[0]);
    if (bare) found.add(bare);
  }

  for (const [sym, names] of Object.entries(aliases())) {
    const s = sym.toUpperCase();
    if (!listed!.has(s) && !extra!.has(s)) continue;
    if (hasAlias(text, names)) found.add(s);
  }

  for (const m of text.matchAll(/\b[A-Z]{2,5}\b/g)) {
    const s = m[0];
    if (!listed!.has(s)) continue;
    if (s === "BE") {
      const prev = text.slice(Math.max(0, (m.index ?? 0) - 6), m.index).toUpperCase();
      if (!/\b(TO|WILL|GONNA)\s*$/.test(prev)) found.add(s);
      continue;
    }
    if (s.length <= 2) continue;
    if (ENGLISH.has(s)) continue;
    found.add(s);
  }

  return [...found];
}

export function pickCommentTicker(raw: string | null, prefer: Set<string>): string {
  const list = (raw || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter((s) => isListedTicker(s));
  const hit = list.find((s) => prefer.has(s));
  return hit || list[0] || "—";
}
