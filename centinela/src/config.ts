import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const DATA_DIR = process.env.CENTINELA_DATA ?? path.join(ROOT, "data");

function applyHaOptions() {
  for (const p of ["/data/options.json", path.join(DATA_DIR, "options.json")]) {
    if (!fs.existsSync(p)) continue;
    try {
      const o = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, string>;
      if (o.mqtt_url) process.env.MQTT_URL ||= o.mqtt_url;
      if (o.mqtt_user) process.env.MQTT_USER ||= o.mqtt_user;
      if (o.mqtt_password) process.env.MQTT_PASSWORD ||= o.mqtt_password;
      if (o.tz) process.env.TZ ||= o.tz;
      if (o.llama_server_url) process.env.LLAMA_SERVER_URL ||= o.llama_server_url;
      if (o.remote_worker_url) process.env.REMOTE_WORKER_URL ||= o.remote_worker_url;
    } catch {
      /* ignore */
    }
  }
}
applyHaOptions();
fs.mkdirSync(DATA_DIR, { recursive: true });

export const config = {
  tz: process.env.TZ || "America/Santiago",
  previewUi: process.env.PREVIEW_UI === "true" || process.env.PREVIEW_UI === "1",
  apiPort: Number(process.env.API_PORT || "18765"),
  previewPort: Number(process.env.PREVIEW_PORT || "38447"),
  mqttUrl: process.env.MQTT_URL || "",
  mqttUser: process.env.MQTT_USER || "",
  mqttPassword: process.env.MQTT_PASSWORD || "",
  quietStart: process.env.QUIET_START || "23:00",
  quietEnd: process.env.QUIET_END || "07:00",
  llamaServerUrl: process.env.LLAMA_SERVER_URL || "",
  remoteWorkerUrl: process.env.REMOTE_WORKER_URL || "",
  fredKey: process.env.FRED_API_KEY || "",
  userAgent: "Centinela/1.0 (+https://github.com/centinela; radar de mercado local)",
  dbPath: path.join(DATA_DIR, "centinela.db"),
};

export const MARKET_TZ = "America/New_York";

export function isRth(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const m = hour * 60 + minute;
  return m >= 9 * 60 + 30 && m < 16 * 60;
}

export function isQuietHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const m = hour * 60 + minute;
  const [qsH, qsM] = config.quietStart.split(":").map(Number);
  const [qeH, qeM] = config.quietEnd.split(":").map(Number);
  const start = qsH * 60 + qsM;
  const end = qeH * 60 + qeM;
  if (start === end) return false;
  if (start < end) return m >= start && m < end;
  return m >= start || m < end;
}
