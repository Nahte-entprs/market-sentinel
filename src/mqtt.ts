import mqtt from "mqtt";
import { config } from "./config.ts";
import type { AlertRecord, IdeaRecord, JobInfo, Regime } from "./types.ts";

type HaDevice = {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
};

const device: HaDevice = {
  identifiers: ["centinela"],
  name: "Centinela",
  manufacturer: "Centinela",
  model: "v1",
};

let client: mqtt.MqttClient | null = null;
const PREFIX = "centinela";
const DISCOVERY = "homeassistant";

export function mqttEnabled() {
  return Boolean(config.mqttUrl);
}

export async function startMqtt(handlers: {
  onAddTicker: (s: string) => void;
  onAddIdea: (title: string, claim: string, factor: string) => void;
  onRunJob: (id: string) => void;
  drafts: { ticker: string; ideaTitle: string; ideaClaim: string; ideaFactor: string };
}) {
  if (!config.mqttUrl) {
    console.log("[mqtt] MQTT_URL vacío — modo local (preview / sin HA).");
    return;
  }
  client = mqtt.connect(config.mqttUrl, {
    username: config.mqttUser || undefined,
    password: config.mqttPassword || undefined,
    clientId: `centinela_${Math.random().toString(16).slice(2)}`,
    reconnectPeriod: 4000,
    will: { topic: `${PREFIX}/status`, payload: "offline", retain: true, qos: 0 },
  });
  client.on("connect", () => {
    console.log("[mqtt] conectado");
    publishDiscovery();
    client?.publish(`${PREFIX}/status`, "online", { retain: true });
    client?.subscribe(`${PREFIX}/cmd/#`);
  });
  client.on("message", (topic, payload) => {
    const msg = payload.toString();
    if (topic === `${PREFIX}/cmd/ticker_draft`) handlers.drafts.ticker = msg;
    if (topic === `${PREFIX}/cmd/idea_title`) handlers.drafts.ideaTitle = msg;
    if (topic === `${PREFIX}/cmd/idea_claim`) handlers.drafts.ideaClaim = msg;
    if (topic === `${PREFIX}/cmd/idea_factor`) handlers.drafts.ideaFactor = msg;
    if (topic === `${PREFIX}/cmd/add_ticker`) handlers.onAddTicker(handlers.drafts.ticker || msg);
    if (topic === `${PREFIX}/cmd/add_idea`) {
      handlers.onAddIdea(handlers.drafts.ideaTitle, handlers.drafts.ideaClaim, handlers.drafts.ideaFactor || msg);
    }
    if (topic.startsWith(`${PREFIX}/cmd/run/`)) {
      handlers.onRunJob(topic.slice(`${PREFIX}/cmd/run/`.length));
    }
  });
  client.on("error", (err) => console.error("[mqtt]", err.message));
}

function disc(component: string, id: string, extra: Record<string, unknown>) {
  const topic = `${DISCOVERY}/${component}/centinela_${id}/config`;
  const payload = {
    unique_id: `centinela_${id}`,
    object_id: `centinela_${id}`,
    device,
    ...extra,
  };
  client?.publish(topic, JSON.stringify(payload), { retain: true });
}

function publishDiscovery() {
  disc("sensor", "regime", {
    name: "Régimen",
    state_topic: `${PREFIX}/sensor/regime`,
    json_attributes_topic: `${PREFIX}/sensor/regime_attr`,
    icon: "mdi:radar",
  });
  disc("sensor", "last_alert", {
    name: "Última alerta",
    state_topic: `${PREFIX}/sensor/last_alert`,
    json_attributes_topic: `${PREFIX}/sensor/last_alert_attr`,
    icon: "mdi:alert-decagram",
  });
  disc("sensor", "digest", {
    name: "Briefing",
    state_topic: `${PREFIX}/sensor/digest`,
    json_attributes_topic: `${PREFIX}/sensor/digest_attr`,
    icon: "mdi:text-box-outline",
  });
  disc("sensor", "watchlist", {
    name: "Watchlist",
    state_topic: `${PREFIX}/sensor/watchlist`,
    json_attributes_topic: `${PREFIX}/sensor/watchlist_attr`,
    icon: "mdi:format-list-bulleted",
  });
  disc("sensor", "ideas", {
    name: "Ideas de mercado",
    state_topic: `${PREFIX}/sensor/ideas`,
    json_attributes_topic: `${PREFIX}/sensor/ideas_attr`,
    icon: "mdi:lightbulb-outline",
  });
  disc("text", "nuevo_ticker", {
    name: "Nuevo ticker",
    command_topic: `${PREFIX}/cmd/ticker_draft`,
    state_topic: `${PREFIX}/text/nuevo_ticker`,
    max: 8,
    mode: "text",
  });
  disc("text", "idea_titulo", {
    name: "Idea título",
    command_topic: `${PREFIX}/cmd/idea_title`,
    state_topic: `${PREFIX}/text/idea_titulo`,
    max: 80,
  });
  disc("text", "idea_claim", {
    name: "Idea claim",
    command_topic: `${PREFIX}/cmd/idea_claim`,
    state_topic: `${PREFIX}/text/idea_claim`,
    max: 255,
  });
  disc("select", "idea_factor", {
    name: "Idea factor",
    command_topic: `${PREFIX}/cmd/idea_factor`,
    state_topic: `${PREFIX}/select/idea_factor`,
    options: [
      "iran",
      "oil",
      "hormuz",
      "china",
      "taiwan",
      "japan",
      "usdjpy",
      "yield10y",
      "fed",
      "tariffs",
      "export_controls",
    ],
  });
  disc("button", "add_ticker", {
    name: "Añadir ticker",
    command_topic: `${PREFIX}/cmd/add_ticker`,
    icon: "mdi:plus",
  });
  disc("button", "add_idea", {
    name: "Añadir idea",
    command_topic: `${PREFIX}/cmd/add_idea`,
    icon: "mdi:lightbulb-plus",
  });
  const jobs = [
    "macro.scan",
    "ticker.events",
    "market.sentiment",
    "volume.unusual",
    "reddit.rising",
    "quotes.poll",
    "ideas.eval",
    "digest.brief",
  ];
  for (const job of jobs) {
    const slug = job.replaceAll(".", "_");
    disc("sensor", `job_${slug}`, {
      name: `Tarea ${job}`,
      state_topic: `${PREFIX}/sensor/job/${job}`,
      json_attributes_topic: `${PREFIX}/sensor/job/${job}/attr`,
    });
    disc("button", `run_${slug}`, {
      name: `Run ${job}`,
      command_topic: `${PREFIX}/cmd/run/${job}`,
      icon: "mdi:play",
    });
  }
}

function pub(topic: string, payload: string | Record<string, unknown>, retain = true) {
  if (!client?.connected) return;
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  client.publish(topic, body, { retain });
}

export function publishAlert(alert: AlertRecord) {
  pub(`${PREFIX}/alert`, alert, false);
  pub(`${PREFIX}/sensor/last_alert`, alert.title.slice(0, 255));
  pub(`${PREFIX}/sensor/last_alert_attr`, {
    ...alert,
    friendly_why: alert.why.map((w) => w.text),
  });
}

export function publishEnrich(id: string, text: string) {
  pub(`${PREFIX}/alert/enrich`, { id, text }, false);
}

export function publishDigest(text: string) {
  pub(`${PREFIX}/digest`, { text, at: new Date().toISOString() }, false);
  pub(`${PREFIX}/sensor/digest`, text.slice(0, 255));
  pub(`${PREFIX}/sensor/digest_attr`, { text });
}

export function publishRegime(regime: Regime, extra?: Record<string, unknown>) {
  pub(`${PREFIX}/regime`, { regime, ...extra }, true);
  pub(`${PREFIX}/sensor/regime`, regime);
  pub(`${PREFIX}/sensor/regime_attr`, extra ?? {});
}

export function publishWatchlist(symbols: string[]) {
  pub(`${PREFIX}/sensor/watchlist`, String(symbols.length));
  pub(`${PREFIX}/sensor/watchlist_attr`, { tickers: symbols });
}

export function publishIdeas(ideas: IdeaRecord[]) {
  pub(`${PREFIX}/sensor/ideas`, String(ideas.length));
  pub(`${PREFIX}/sensor/ideas_attr`, { ideas });
}

export function publishJob(job: JobInfo) {
  pub(`${PREFIX}/sensor/job/${job.id}`, job.lastStatus);
  pub(`${PREFIX}/sensor/job/${job.id}/attr`, {
    lastRunAt: job.lastRunAt,
    error: job.lastError,
    note: job.lastNote,
    name: job.name,
  });
}

export function publishStatus(payload: Record<string, unknown>) {
  pub(`${PREFIX}/status`, { state: "online", ...payload, ts: new Date().toISOString() });
}

export function publishTextState(drafts: { ticker: string; ideaTitle: string; ideaClaim: string; ideaFactor: string }) {
  pub(`${PREFIX}/text/nuevo_ticker`, drafts.ticker);
  pub(`${PREFIX}/text/idea_titulo`, drafts.ideaTitle);
  pub(`${PREFIX}/text/idea_claim`, drafts.ideaClaim);
  pub(`${PREFIX}/select/idea_factor`, drafts.ideaFactor || "iran");
}
