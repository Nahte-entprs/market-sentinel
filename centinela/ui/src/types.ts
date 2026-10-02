export type Tab = "radar" | "cartera" | "reddit" | "ideas";

export type Why = { text: string; kind: string; weight: number };

export type Alert = {
  id: string;
  title: string;
  summary: string;
  score: number;
  confidence: number;
  regime: string;
  why: Why[];
  jobIds: string[];
  symbols: string[];
  sources: { title: string; url: string; tier: string }[];
  createdAt: string;
  enrichText?: string | null;
};

export type Job = {
  id: string;
  letter?: string;
  name: string;
  description: string;
  lastRunAt: string | null;
  lastStatus: string;
  lastError: string | null;
  lastNote: string | null;
};

export type Idea = {
  id: string;
  title: string;
  claim: string;
  factorId: string;
  verdict: "open" | "supported" | "refuted" | "mixed";
  evidence: { text: string; url?: string; direction: string }[];
  updatedAt: string;
};

export type Category = "holding" | "priority" | "watchlist";

export type Position = {
  symbol: string;
  name: string;
  category: Category;
  invested: number;
  invested_fmt: string;
  fair: number | null;
  fair_fmt: string | null;
  fair_delta_pct: number | null;
  price: number | null;
  price_fmt: string;
  change_pct: number | null;
  change_fmt: string;
  rec_label: string;
  analyst_count: number | null;
  target_fmt: string | null;
  ma50: number | null;
  ma100: number | null;
  ma200: number | null;
  ma50_delta_pct: number | null;
  volume_ratio: number | null;
  week52_line: string;
  line2: string;
  line3: string;
  icon_color: string;
};

export type TickerHit = {
  ticker: string;
  comments: number;
  variants?: number;
  ratio7d: number | null;
  subs?: string[];
};

export type CommentQuote = {
  ticker: string;
  body: string;
  score: number;
  sub: string;
};

export type SocialRun = {
  source: string;
  comments: number;
  threadTitle: string | null;
  threadKind: string;
  schedule: string;
  emerging: TickerHit[];
  emergingBySub: { sub: string; tickers: TickerHit[] }[];
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
  storage: { keepDays: number; comments: number; oldestNyDay: string | null };
  errors: string[];
};

export type AppState = {
  regime: string;
  threshold: number;
  jobs: Job[];
  tickers: { symbol: string; name: string; sector: string; category?: Category }[];
  cartera: {
    holding: Position[];
    priority: Position[];
    watch: Position[];
  };
  factors: { id: string; label: string }[];
  ideas: Idea[];
  quotes: { symbol: string; price: number; changePct: number; volumeRatio: number }[];
  alerts: Alert[];
  lastAlert: Alert | null;
  digest: string | null;
  digestAt: string | null;
  news: { title: string; url: string; tier: string; source: string }[];
  reddit: { wsb: SocialRun | null; subs: SocialRun | null };
  disclaimer: string;
};

export const regimeColor: Record<string, string> = {
  NORMAL: "bg-ha-green",
  WATCH: "bg-ha-amber",
  "HIGH ALERT": "bg-orange-600",
  CRISIS: "bg-ha-red",
};

export const verdictColor: Record<Idea["verdict"], string> = {
  open: "bg-white/10 text-ha-muted",
  supported: "bg-ha-green/20 text-ha-green",
  refuted: "bg-ha-red/20 text-ha-red",
  mixed: "bg-ha-amber/20 text-ha-amber",
};

export function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CL", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}
