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

export type QuoteSnap = {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  ts: string;
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
