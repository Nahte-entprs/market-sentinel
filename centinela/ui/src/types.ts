export type Tab = "radar" | "cartera" | "reddit" | "ideas" | "config";

export type WatchBand = {
  changePct: number;
  volumeRatio: number;
  trendPct: number;
  intradayVolumeRatio: number;
  sessionPaceRatio: number;
  sessionFadeRatio: number;
};

export type AppSettings = {
  reddit: {
    minMentions: number;
    maxTickers: number;
    pageSize: number;
    minChars: number;
    maxChars: number;
    blockText: string;
    keepDays: number;
    commentsDaily: number;
    hotPostsPerSub: number;
    commentsPerPost: number;
    spikeLast1h: number;
    spikeVelocity: number;
    velocityQuietHour: number;
    velocityBurst1h: number;
    alertLast1h: number;
    surgeUpRatio: number;
    surgeDownRatio: number;
    surgeMinGap: number;
  };
  cartera: {
    holding: WatchBand;
    priority: WatchBand;
    watchlist: WatchBand;
    radarChangePct: number;
    radarVolumeDaily: number;
    radarVolume5m: number;
    radarSessionPace: number;
    radarSessionFade: number;
    sectorMovePct: number;
    steepQuietPct: number;
  };
  alertas: {
    scoreNormal: number;
    scoreWatch: number;
    scoreHigh: number;
    scoreCrisis: number;
    cooldownNormalMin: number;
    cooldownWatchMin: number;
    cooldownHighMin: number;
    cooldownCrisisMin: number;
    crisisPushHours: number;
    crisisBypassScore: number;
    quietStart: string;
    quietEnd: string;
  };
  regimen: {
    watchSpy: number;
    watchQqq: number;
    watchSmh: number;
    watchVix: number;
    highSpy: number;
    highQqq: number;
    highSmh: number;
    highVix: number;
    crisisSpy: number;
    crisisQqq: number;
    crisisSmh: number;
    crisisOil: number;
    crisisVixChange: number;
  };
};

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
  shares: number;
  shares_fmt: string;
  market_value_fmt: string | null;
  fair: number | null;
  fair_fmt: string | null;
  fair_delta_pct: number | null;
  fair_delta_fmt: string;
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
  ma100_delta_pct: number | null;
  ma200_delta_pct: number | null;
  burst_ratio: number | null;
  burst_samples: number;
  pace_ratio: number | null;
  pace_samples: number;
  session_done: boolean;
  volume_avg: number[];
  volume_today: number[];
  quote_error: string | null;
  week52_line: string;
  icon_color: string;
};

export type TickerPace = {
  ticker: string;
  comments: number;
  last1h: number;
  last3h: number;
  velocity: number;
  spike: boolean;
  trend?: "up" | "flat" | "down";
  paceDelta?: number;
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
  created?: string;
  author?: string;
  authorFlair?: string;
  postTitle?: string;
  postUrl?: string;
};

export type CommentPage = {
  total: number;
  offset: number;
  limit: number;
  comments: CommentQuote[];
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
  windowHours?: number;
  windowComments?: number;
  tickers24h?: TickerPace[];
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
  settings: AppSettings;
  disclaimer: string;
};

export const regimeColor: Record<string, string> = {
  NORMAL: "bg-ha-green",
  WATCH: "bg-ha-amber",
  "HIGH ALERT": "bg-orange-600",
  CRISIS: "bg-ha-red",
};

export const verdictColor: Record<Idea["verdict"], string> = {
  open: "bg-ha-text/10 text-ha-muted",
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
