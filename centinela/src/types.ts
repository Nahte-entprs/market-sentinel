export type SourceTier = "T0" | "T1" | "T2" | "T3";
export type Regime = "NORMAL" | "WATCH" | "HIGH ALERT" | "CRISIS";
export type IdeaVerdict = "open" | "supported" | "refuted" | "mixed";
export type JobStatus = "idle" | "running" | "ok" | "error";

export type WhyItem = {
  text: string;
  kind:
    | "price"
    | "volume"
    | "sector"
    | "macro"
    | "news"
    | "thesis"
    | "idea"
    | "wsb"
    | "narrative"
    | "divergence"
    | "graph"
    | "regime";
  weight: number;
};

export type Candidate = {
  title: string;
  score: number;
  confidence: number;
  why: WhyItem[];
  jobIds: string[];
  clusterId?: string | null;
  symbols: string[];
  sources: { title: string; url: string; tier: SourceTier }[];
};

export type AlertRecord = {
  id: string;
  title: string;
  summary: string;
  score: number;
  confidence: number;
  regime: Regime;
  why: WhyItem[];
  jobIds: string[];
  clusterId: string | null;
  symbols: string[];
  sources: { title: string; url: string; tier: SourceTier }[];
  createdAt: string;
  enrichedAt?: string | null;
  enrichText?: string | null;
};

export type IdeaRecord = {
  id: string;
  title: string;
  claim: string;
  factorId: string;
  verdict: IdeaVerdict;
  evidence: { text: string; url?: string; direction: "support" | "refute" }[];
  updatedAt: string;
};

export type JobInfo = {
  id: string;
  letter?: string;
  name: string;
  description: string;
  cadenceMs: () => number;
  lastRunAt: string | null;
  lastStatus: JobStatus;
  lastError: string | null;
  lastNote: string | null;
};

export type TickerCategory = "holding" | "priority" | "watchlist";

export type QuoteSnap = {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  ts: string;
  ma50: number | null;
  ma100: number | null;
  ma200: number | null;
  targetMean: number | null;
  recMean: number | null;
  recKey: string | null;
  analystCount: number | null;
  week52High: number | null;
  week52Low: number | null;
  /** Falso cuando el porcentaje guardado no se puede apoyar en dos velas diarias. */
  changeTrusted: boolean;
};

export type CarteraPosition = {
  symbol: string;
  name: string;
  category: TickerCategory;
  shares: number;
  shares_fmt: string;
  market_value: number | null;
  market_value_fmt: string | null;
  fair: number | null;
  fair_fmt: string | null;
  /** (precio − fair) / fair. Positivo: el mercado está por encima del fair. */
  fair_delta_pct: number | null;
  fair_delta_fmt: string;
  price: number | null;
  price_fmt: string;
  change_pct: number | null;
  change_fmt: string;
  rec_label: string;
  rec_key: string | null;
  analyst_count: number | null;
  target_mean: number | null;
  target_fmt: string | null;
  ma50: number | null;
  ma100: number | null;
  ma200: number | null;
  ma50_delta_pct: number | null;
  ma100_delta_pct: number | null;
  ma200_delta_pct: number | null;
  volume_ratio: number | null;
  burst_ratio: number | null;
  burst_samples: number;
  pace_ratio: number | null;
  pace_samples: number;
  session_done: boolean;
  /** Promedio de 14 sesiones, 78 cubetas de 5 min desde las 9:30 ET. */
  volume_avg: number[];
  /** Última sesión, mismas cubetas. */
  volume_today: number[];
  quote_error: string | null;
  week52_high: number | null;
  week52_low: number | null;
  week52_pos: number | null;
  week52_line: string;
  line2: string;
  line3: string;
  icon_color: string;
  badge_icon: string;
  badge_color: string;
};

export type TickerAlert = {
  symbol: string;
  category: TickerCategory;
  title: string;
  message: string;
  changePct: number;
  volumeRatio: number;
  reasons: string[];
  at: string;
};

export type NotifySection = "radar" | "cartera" | "reddit" | "ideas";

export type CentinelaNotify = {
  section: NotifySection;
  title: string;
  message: string;
  url: string;
  at: string;
  tag?: string;
};

export type TickerPace = {
  ticker: string;
  comments: number;
  last1h: number;
  last3h: number;
  velocity: number;
  spike: boolean;
  trend: "up" | "flat" | "down";
  paceDelta: number;
};

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  tier: SourceTier;
  publishedAt: string;
  firstSeenAt: string;
  clusterId: string;
  entities: string[];
  echoCount: number;
};
