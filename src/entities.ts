import { listFactors, listTickers } from "./universe.ts";
import { graphNodes } from "./graph.ts";
import thesisFile from "../data/thesis.json" with { type: "json" };

export type ThesisBook = Record<
  string,
  {
    bull: { id: string; label: string; keywords: string[]; nodes: string[] }[];
    bear: { id: string; label: string; keywords: string[]; nodes: string[] }[];
    catalysts: { id: string; label: string; keywords: string[]; nodes: string[] }[];
    risks: { id: string; label: string; keywords: string[]; nodes: string[] }[];
  }
>;

export const thesis = thesisFile as ThesisBook;

const MEGA = new Set(["NVDA", "MSFT", "AAPL", "GOOG", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "BRK.B"]);

export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string) {
  return normalizeText(s)
    .split(" ")
    .filter((w) => w.length > 3);
}

export function jaccard(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

const TICKER_RE = /\b[A-Z]{1,5}\b/g;
const CASH_RE = /\$([A-Za-z]{1,5})\b/g;

export function extractCashtags(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(CASH_RE)) found.add(m[1].toUpperCase());
  return [...found];
}

export function extractEntities(text: string): string[] {
  const n = normalizeText(text);
  const found = new Set<string>();
  const watch = new Set(listTickers().map((t) => t.symbol.toLowerCase()));

  for (const f of listFactors()) {
    const kws = JSON.parse(f.keywords) as string[];
    if (kws.some((k) => n.includes(k.toLowerCase()))) found.add(f.id);
  }
  for (const node of graphNodes) {
    if (node.kind === "theme" || node.kind === "sector") {
      if (n.includes(node.label.toLowerCase()) || n.includes(node.id.replaceAll("_", " "))) found.add(node.id);
    }
  }
  for (const m of text.matchAll(CASH_RE)) {
    const s = m[1].toUpperCase();
    if (watch.has(s.toLowerCase())) found.add(s);
  }
  for (const m of text.toUpperCase().matchAll(TICKER_RE)) {
    const s = m[0];
    if (watch.has(s.toLowerCase()) && s.length >= 2) found.add(s);
  }
  // thesis keywords
  for (const [sym, book] of Object.entries(thesis)) {
    for (const group of [book.bull, book.bear, book.catalysts, book.risks]) {
      for (const p of group) {
        if (p.keywords.some((k) => n.includes(k.toLowerCase()))) {
          found.add(sym);
          for (const node of p.nodes) found.add(node);
        }
      }
    }
  }
  return [...found];
}

export function matchThesis(text: string) {
  const n = normalizeText(text);
  const hits: { symbol: string; side: "bull" | "bear" | "catalyst" | "risk"; pillar: string; label: string }[] = [];
  for (const [sym, book] of Object.entries(thesis)) {
    for (const p of book.bull) if (p.keywords.some((k) => n.includes(k.toLowerCase()))) hits.push({ symbol: sym, side: "bull", pillar: p.id, label: p.label });
    for (const p of book.bear) if (p.keywords.some((k) => n.includes(k.toLowerCase()))) hits.push({ symbol: sym, side: "bear", pillar: p.id, label: p.label });
    for (const p of book.catalysts) if (p.keywords.some((k) => n.includes(k.toLowerCase()))) hits.push({ symbol: sym, side: "catalyst", pillar: p.id, label: p.label });
    for (const p of book.risks) if (p.keywords.some((k) => n.includes(k.toLowerCase()))) hits.push({ symbol: sym, side: "risk", pillar: p.id, label: p.label });
  }
  return hits;
}

export function isMegaCap(symbol: string) {
  return MEGA.has(symbol.toUpperCase());
}

export const BULL_WORDS = [
  "surge",
  "soar",
  "beat",
  "upgrade",
  "record",
  "bullish",
  "rally",
  "moon",
  "calls",
  "breakout",
  "inclusion",
  "added to",
];
export const BEAR_WORDS = [
  "plunge",
  "crash",
  "downgrade",
  "miss",
  "bearish",
  "selloff",
  "puts",
  "halt",
  "sanction",
  "war",
  "strike",
  "recession",
  "ban",
];

export function lexiconPolarity(text: string): number {
  const n = normalizeText(text);
  let s = 0;
  for (const w of BULL_WORDS) if (n.includes(w)) s += 1;
  for (const w of BEAR_WORDS) if (n.includes(w)) s -= 1;
  return s;
}
