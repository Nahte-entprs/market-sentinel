import { getSetting, parseJson, setSetting } from "./db.ts";
import { config } from "./config.ts";

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

const DEFAULTS: AppSettings = {
  reddit: {
    minMentions: 5,
    maxTickers: 40,
    pageSize: 10,
    minChars: 40,
    maxChars: 0,
    blockText: "",
    keepDays: 31,
    commentsDaily: 220,
    hotPostsPerSub: 5,
    commentsPerPost: 40,
    spikeLast1h: 6,
    spikeVelocity: 2.5,
    velocityQuietHour: 0.4,
    velocityBurst1h: 5,
    alertLast1h: 15,
    surgeUpRatio: 1.4,
    surgeDownRatio: 0.7,
    surgeMinGap: 1,
  },
  cartera: {
    holding: { changePct: 2, volumeRatio: 2, trendPct: 4, intradayVolumeRatio: 3.5, sessionPaceRatio: 1.5, sessionFadeRatio: 0.7 },
    priority: { changePct: 2, volumeRatio: 2, trendPct: 5, intradayVolumeRatio: 3.5, sessionPaceRatio: 1.5, sessionFadeRatio: 0.7 },
    watchlist: { changePct: 3.5, volumeRatio: 2.5, trendPct: 8, intradayVolumeRatio: 4.5, sessionPaceRatio: 1.8, sessionFadeRatio: 0.55 },
    radarChangePct: 1.5,
    radarVolumeDaily: 2.5,
    radarVolume5m: 3,
    radarSessionPace: 1.6,
    radarSessionFade: 0.65,
    sectorMovePct: 2,
    steepQuietPct: 5,
  },
  alertas: {
    scoreNormal: 8,
    scoreWatch: 6,
    scoreHigh: 5,
    scoreCrisis: 4,
    cooldownNormalMin: 45,
    cooldownWatchMin: 35,
    cooldownHighMin: 20,
    cooldownCrisisMin: 8,
    crisisPushHours: 6,
    crisisBypassScore: 7,
    quietStart: "23:00",
    quietEnd: "07:00",
  },
  regimen: {
    watchSpy: -1,
    watchQqq: -1.5,
    watchSmh: -2,
    watchVix: 22,
    highSpy: -1.5,
    highQqq: -2,
    highSmh: -3,
    highVix: 26,
    crisisSpy: -2,
    crisisQqq: -3,
    crisisSmh: -4,
    crisisOil: 3,
    crisisVixChange: 15,
  },
};

const KEY = "app_config";

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clock(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function band(raw: unknown, fallback: WatchBand): WatchBand {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    changePct: num(o.changePct, fallback.changePct, 0.1, 50),
    volumeRatio: num(o.volumeRatio, fallback.volumeRatio, 0.5, 50),
    trendPct: num(o.trendPct, fallback.trendPct, 0.1, 80),
    intradayVolumeRatio: num(o.intradayVolumeRatio, fallback.intradayVolumeRatio, 0.5, 50),
    sessionPaceRatio: num(o.sessionPaceRatio, fallback.sessionPaceRatio, 1.05, 10),
    sessionFadeRatio: num(o.sessionFadeRatio, fallback.sessionFadeRatio, 0.15, 0.95),
  };
}

export function normalizeSettings(raw: unknown): AppSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const r = o.reddit && typeof o.reddit === "object" ? (o.reddit as Record<string, unknown>) : {};
  const c = o.cartera && typeof o.cartera === "object" ? (o.cartera as Record<string, unknown>) : {};
  const a = o.alertas && typeof o.alertas === "object" ? (o.alertas as Record<string, unknown>) : {};
  const g = o.regimen && typeof o.regimen === "object" ? (o.regimen as Record<string, unknown>) : {};
  const d = DEFAULTS;
  const block = typeof r.blockText === "string" ? r.blockText.slice(0, 8000) : d.reddit.blockText;
  return {
    reddit: {
      minMentions: num(r.minMentions, d.reddit.minMentions, 1, 500),
      maxTickers: num(r.maxTickers, d.reddit.maxTickers, 5, 200),
      pageSize: Math.round(num(r.pageSize, d.reddit.pageSize, 5, 50)),
      minChars: Math.round(num(r.minChars, d.reddit.minChars, 0, 2000)),
      maxChars: Math.round(num(r.maxChars, d.reddit.maxChars, 0, 20000)),
      blockText: block,
      keepDays: Math.round(num(r.keepDays, d.reddit.keepDays, 1, 90)),
      commentsDaily: Math.round(num(r.commentsDaily, d.reddit.commentsDaily, 20, 500)),
      hotPostsPerSub: Math.round(num(r.hotPostsPerSub, d.reddit.hotPostsPerSub, 1, 20)),
      commentsPerPost: Math.round(num(r.commentsPerPost, d.reddit.commentsPerPost, 5, 200)),
      spikeLast1h: num(r.spikeLast1h, d.reddit.spikeLast1h, 1, 200),
      spikeVelocity: num(r.spikeVelocity, d.reddit.spikeVelocity, 0.5, 50),
      velocityQuietHour: num(r.velocityQuietHour, d.reddit.velocityQuietHour, 0.05, 20),
      velocityBurst1h: num(r.velocityBurst1h, d.reddit.velocityBurst1h, 1, 100),
      alertLast1h: num(r.alertLast1h, d.reddit.alertLast1h, 1, 300),
      surgeUpRatio: num(r.surgeUpRatio, d.reddit.surgeUpRatio, 1.05, 6),
      surgeDownRatio: num(r.surgeDownRatio, d.reddit.surgeDownRatio, 0.05, 0.95),
      surgeMinGap: num(r.surgeMinGap, d.reddit.surgeMinGap, 0, 30),
    },
    cartera: {
      holding: band(c.holding, d.cartera.holding),
      priority: band(c.priority, d.cartera.priority),
      watchlist: band(c.watchlist, d.cartera.watchlist),
      radarChangePct: num(c.radarChangePct, d.cartera.radarChangePct, 0.1, 30),
      radarVolumeDaily: num(c.radarVolumeDaily, d.cartera.radarVolumeDaily, 0.5, 40),
      radarVolume5m: num(c.radarVolume5m, d.cartera.radarVolume5m, 0.5, 40),
      radarSessionPace: num(c.radarSessionPace, d.cartera.radarSessionPace, 1.05, 10),
      radarSessionFade: num(c.radarSessionFade, d.cartera.radarSessionFade, 0.15, 0.95),
      sectorMovePct: num(c.sectorMovePct, d.cartera.sectorMovePct, 0.1, 30),
      steepQuietPct: num(c.steepQuietPct, d.cartera.steepQuietPct, 0.5, 40),
    },
    alertas: {
      scoreNormal: num(a.scoreNormal, d.alertas.scoreNormal, 1, 20),
      scoreWatch: num(a.scoreWatch, d.alertas.scoreWatch, 1, 20),
      scoreHigh: num(a.scoreHigh, d.alertas.scoreHigh, 1, 20),
      scoreCrisis: num(a.scoreCrisis, d.alertas.scoreCrisis, 1, 20),
      cooldownNormalMin: num(a.cooldownNormalMin, d.alertas.cooldownNormalMin, 1, 720),
      cooldownWatchMin: num(a.cooldownWatchMin, d.alertas.cooldownWatchMin, 1, 720),
      cooldownHighMin: num(a.cooldownHighMin, d.alertas.cooldownHighMin, 1, 720),
      cooldownCrisisMin: num(a.cooldownCrisisMin, d.alertas.cooldownCrisisMin, 1, 720),
      crisisPushHours: num(a.crisisPushHours, d.alertas.crisisPushHours, 1, 72),
      crisisBypassScore: num(a.crisisBypassScore, d.alertas.crisisBypassScore, 1, 20),
      quietStart: clock(a.quietStart, config.quietStart || d.alertas.quietStart),
      quietEnd: clock(a.quietEnd, config.quietEnd || d.alertas.quietEnd),
    },
    regimen: {
      watchSpy: num(g.watchSpy, d.regimen.watchSpy, -30, 5),
      watchQqq: num(g.watchQqq, d.regimen.watchQqq, -30, 5),
      watchSmh: num(g.watchSmh, d.regimen.watchSmh, -40, 5),
      watchVix: num(g.watchVix, d.regimen.watchVix, 8, 80),
      highSpy: num(g.highSpy, d.regimen.highSpy, -30, 5),
      highQqq: num(g.highQqq, d.regimen.highQqq, -30, 5),
      highSmh: num(g.highSmh, d.regimen.highSmh, -40, 5),
      highVix: num(g.highVix, d.regimen.highVix, 8, 90),
      crisisSpy: num(g.crisisSpy, d.regimen.crisisSpy, -40, 0),
      crisisQqq: num(g.crisisQqq, d.regimen.crisisQqq, -40, 0),
      crisisSmh: num(g.crisisSmh, d.regimen.crisisSmh, -50, 0),
      crisisOil: num(g.crisisOil, d.regimen.crisisOil, 0.5, 40),
      crisisVixChange: num(g.crisisVixChange, d.regimen.crisisVixChange, 1, 80),
    },
  };
}

export function appSettings(): AppSettings {
  const raw = getSetting(KEY, "");
  if (!raw) {
    return normalizeSettings({
      alertas: { quietStart: config.quietStart, quietEnd: config.quietEnd },
    });
  }
  return normalizeSettings(parseJson(raw, {}));
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function saveAppSettings(patch: unknown): AppSettings {
  const cur = appSettings();
  const p = asRecord(patch);
  const cartera = asRecord(p.cartera);
  const next = normalizeSettings({
    reddit: { ...cur.reddit, ...asRecord(p.reddit) },
    cartera: {
      ...cur.cartera,
      ...cartera,
      holding: { ...cur.cartera.holding, ...asRecord(cartera.holding) },
      priority: { ...cur.cartera.priority, ...asRecord(cartera.priority) },
      watchlist: { ...cur.cartera.watchlist, ...asRecord(cartera.watchlist) },
    },
    alertas: { ...cur.alertas, ...asRecord(p.alertas) },
    regimen: { ...cur.regimen, ...asRecord(p.regimen) },
  });
  setSetting(KEY, JSON.stringify(next));
  return next;
}

export function blockPhrases(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().toLowerCase();
    if (p.length < 2 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 80) break;
  }
  return out;
}

export function quietHoursActive(now = new Date()): boolean {
  const { quietStart, quietEnd } = appSettings().alertas;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const m = hour * 60 + minute;
  const [qsH, qsM] = quietStart.split(":").map(Number);
  const [qeH, qeM] = quietEnd.split(":").map(Number);
  const start = qsH * 60 + qsM;
  const end = qeH * 60 + qeM;
  if (start === end) return false;
  if (start < end) return m >= start && m < end;
  return m >= start || m < end;
}
