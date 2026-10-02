import { getSetting, parseJson, setSetting } from "./db.ts";
import type { SocialRun } from "./reddit-social.ts";

export function saveSocialRun(run: SocialRun) {
  const key = run.source === "wsb_daily" ? "social_wsb" : "social_subs";
  setSetting(key, JSON.stringify(run));
}

export function loadSocialRun(kind: "wsb" | "subs"): SocialRun | null {
  const raw = getSetting(kind === "wsb" ? "social_wsb" : "social_subs", "");
  if (!raw) return null;
  const run = parseJson<SocialRun | null>(raw, null);
  if (!run) return null;
  return {
    ...run,
    windowHours: run.windowHours ?? 24,
    windowComments: run.windowComments ?? 0,
    tickers24h: run.tickers24h ?? [],
  };
}
