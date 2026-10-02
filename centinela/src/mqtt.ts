import mqtt from "mqtt";
import { config } from "./config.ts";
import type { AlertRecord, CarteraPosition, CentinelaNotify, IdeaRecord, JobInfo, NotifySection, Regime, TickerAlert } from "./types.ts";
import type { SocialRun } from "./reddit-social.ts";

export type MqttDrafts = {
  ticker: string;
  ideaTitle: string;
  ideaClaim: string;
  ideaFactor: string;
  category: string;
  investedUsd: number;
  fairPrice: number;
};

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
  onSaveTicker: () => void;
  onRemoveTicker: () => void;
  onMoveTicker: (dir: "up" | "down") => void;
  onTickerDraft: (s: string) => void;
  onAddIdea: (title: string, claim: string, factor: string) => void;
  onRunJob: (id: string) => void;
  onReady?: () => void;
  drafts: MqttDrafts;
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
    handlers.onReady?.();
  });
  client.on("message", (topic, payload) => {
    const msg = payload.toString();
    if (topic === `${PREFIX}/cmd/ticker_draft`) {
      handlers.drafts.ticker = msg;
      handlers.onTickerDraft(msg);
    }
    if (topic === `${PREFIX}/cmd/ticker_category`) handlers.drafts.category = msg;
    if (topic === `${PREFIX}/cmd/ticker_invested`) handlers.drafts.investedUsd = Number(msg) || 0;
    if (topic === `${PREFIX}/cmd/ticker_fair`) handlers.drafts.fairPrice = Number(msg) || 0;
    if (topic === `${PREFIX}/cmd/idea_title`) handlers.drafts.ideaTitle = msg;
    if (topic === `${PREFIX}/cmd/idea_claim`) handlers.drafts.ideaClaim = msg;
    if (topic === `${PREFIX}/cmd/idea_factor`) handlers.drafts.ideaFactor = msg;
    if (topic === `${PREFIX}/cmd/add_ticker`) handlers.onAddTicker(handlers.drafts.ticker || msg);
    if (topic === `${PREFIX}/cmd/save_ticker`) handlers.onSaveTicker();
    if (topic === `${PREFIX}/cmd/remove_ticker`) handlers.onRemoveTicker();
    if (topic === `${PREFIX}/cmd/ticker_up`) handlers.onMoveTicker("up");
    if (topic === `${PREFIX}/cmd/ticker_down`) handlers.onMoveTicker("down");
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
  const objectId = `centinela_${id}`;
  const topic = `${DISCOVERY}/${component}/${objectId}/config`;
  const payload = {
    unique_id: objectId,
    default_entity_id: `${component}.${objectId}`,
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
  disc("sensor", "holding", {
    name: "Holding",
    state_topic: `${PREFIX}/sensor/holding`,
    json_attributes_topic: `${PREFIX}/sensor/holding_attr`,
    icon: "mdi:briefcase-outline",
  });
  disc("sensor", "priority", {
    name: "Priority",
    state_topic: `${PREFIX}/sensor/priority`,
    json_attributes_topic: `${PREFIX}/sensor/priority_attr`,
    icon: "mdi:star-four-points",
  });
  disc("sensor", "watch", {
    name: "Watch",
    state_topic: `${PREFIX}/sensor/watch`,
    json_attributes_topic: `${PREFIX}/sensor/watch_attr`,
    icon: "mdi:eye-outline",
  });
  disc("sensor", "ideas", {
    name: "Ideas de mercado",
    state_topic: `${PREFIX}/sensor/ideas`,
    json_attributes_topic: `${PREFIX}/sensor/ideas_attr`,
    icon: "mdi:lightbulb-outline",
  });
  disc("sensor", "reddit_wsb", {
    name: "reddit wsb",
    state_topic: `${PREFIX}/sensor/reddit_wsb`,
    json_attributes_topic: `${PREFIX}/sensor/reddit_wsb_attr`,
    icon: "mdi:reddit",
  });
  disc("sensor", "reddit_subs", {
    name: "reddit subs",
    state_topic: `${PREFIX}/sensor/reddit_subs`,
    json_attributes_topic: `${PREFIX}/sensor/reddit_subs_attr`,
    icon: "mdi:reddit",
  });
  disc("sensor", "reddit_emerging", {
    name: "reddit emerging",
    state_topic: `${PREFIX}/sensor/reddit_emerging`,
    json_attributes_topic: `${PREFIX}/sensor/reddit_emerging_attr`,
    icon: "mdi:chart-timeline-variant",
  });
  disc("sensor", "last_notify", {
    name: "Último aviso",
    state_topic: `${PREFIX}/sensor/last_notify`,
    json_attributes_topic: `${PREFIX}/sensor/last_notify_attr`,
    icon: "mdi:cellphone-message",
  });
  disc("text", "nuevo_ticker", {
    name: "Nuevo ticker",
    command_topic: `${PREFIX}/cmd/ticker_draft`,
    state_topic: `${PREFIX}/text/nuevo_ticker`,
    max: 16,
    mode: "text",
  });
  disc("select", "ticker_categoria", {
    name: "Lista ticker",
    command_topic: `${PREFIX}/cmd/ticker_category`,
    state_topic: `${PREFIX}/select/ticker_categoria`,
    options: ["holding", "priority", "watchlist"],
    icon: "mdi:format-list-group",
  });
  disc("number", "invertido", {
    name: "USD invertido",
    command_topic: `${PREFIX}/cmd/ticker_invested`,
    state_topic: `${PREFIX}/number/invertido`,
    min: 0,
    max: 10000000,
    step: 50,
    mode: "box",
    unit_of_measurement: "USD",
    icon: "mdi:cash",
  });
  disc("number", "fair_price", {
    name: "Fair price",
    command_topic: `${PREFIX}/cmd/ticker_fair`,
    state_topic: `${PREFIX}/number/fair_price`,
    min: 0,
    max: 100000,
    step: 0.01,
    mode: "box",
    unit_of_measurement: "USD",
    icon: "mdi:scale-balance",
  });
  disc("button", "save_ticker", {
    name: "Guardar ticker",
    command_topic: `${PREFIX}/cmd/save_ticker`,
    icon: "mdi:content-save",
  });
  disc("button", "remove_ticker", {
    name: "Quitar ticker",
    command_topic: `${PREFIX}/cmd/remove_ticker`,
    icon: "mdi:minus",
  });
  disc("button", "ticker_up", {
    name: "Subir ticker",
    command_topic: `${PREFIX}/cmd/ticker_up`,
    icon: "mdi:chevron-up",
  });
  disc("button", "ticker_down", {
    name: "Bajar ticker",
    command_topic: `${PREFIX}/cmd/ticker_down`,
    icon: "mdi:chevron-down",
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
    "reddit.subs",
    "quotes.poll",
    "fundamentals.poll",
    "ideas.eval",
    "digest.brief",
  ];
  for (const job of jobs) {
    const slug = job.replaceAll(".", "_");
    disc("sensor", `job_${slug}`, {
      name: `job ${job.replaceAll(".", " ")}`,
      state_topic: `${PREFIX}/sensor/job/${job}`,
      json_attributes_topic: `${PREFIX}/sensor/job/${job}/attr`,
    });
    disc("button", `run_${slug}`, {
      name: `run ${job.replaceAll(".", " ")}`,
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

export function notifyUrl(section: NotifySection) {
  return `/hassio/ingress/local_centinela?tab=${section}`;
}

export function publishNotify(n: CentinelaNotify) {
  pub(`${PREFIX}/notify`, n, false);
  pub(`${PREFIX}/sensor/last_notify`, n.title.slice(0, 255));
  pub(`${PREFIX}/sensor/last_notify_attr`, n);
}

function sectionOfAlert(alert: AlertRecord): NotifySection {
  if (alert.jobIds.includes("ideas.eval")) return "ideas";
  if (alert.jobIds.some((id) => id.startsWith("reddit"))) return "reddit";
  return "radar";
}

export function publishAlert(alert: AlertRecord) {
  pub(`${PREFIX}/alert`, alert, false);
  pub(`${PREFIX}/sensor/last_alert`, alert.title.slice(0, 255));
  pub(`${PREFIX}/sensor/last_alert_attr`, {
    ...alert,
    friendly_why: alert.why.map((w) => w.text),
  });
  const section = sectionOfAlert(alert);
  publishNotify({
    section,
    title: alert.title,
    message: alert.summary.slice(0, 280),
    url: notifyUrl(section),
    at: alert.createdAt,
  });
}

export function publishEnrich(id: string, text: string) {
  pub(`${PREFIX}/alert/enrich`, { id, text }, false);
}

export function publishDigest(text: string) {
  const at = new Date().toISOString();
  pub(`${PREFIX}/digest`, { text, at }, false);
  pub(`${PREFIX}/sensor/digest`, text.slice(0, 255));
  pub(`${PREFIX}/sensor/digest_attr`, { text });
  publishNotify({
    section: "radar",
    title: "Centinela briefing",
    message: text.slice(0, 220),
    url: notifyUrl("radar"),
    at,
  });
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

export function publishCartera(lists: {
  holding: CarteraPosition[];
  priority: CarteraPosition[];
  watch: CarteraPosition[];
}) {
  pub(`${PREFIX}/sensor/holding`, String(lists.holding.length));
  pub(`${PREFIX}/sensor/holding_attr`, { positions: lists.holding });
  pub(`${PREFIX}/sensor/priority`, String(lists.priority.length));
  pub(`${PREFIX}/sensor/priority_attr`, { positions: lists.priority });
  pub(`${PREFIX}/sensor/watch`, String(lists.watch.length));
  pub(`${PREFIX}/sensor/watch_attr`, { positions: lists.watch });
}

export function publishTickerAlert(alert: TickerAlert) {
  pub(`${PREFIX}/ticker_alert`, alert, false);
  publishNotify({
    section: "cartera",
    title: alert.title,
    message: alert.message,
    url: notifyUrl("cartera"),
    at: alert.at,
  });
}

export function publishIdeas(ideas: IdeaRecord[]) {
  pub(`${PREFIX}/sensor/ideas`, String(ideas.length));
  pub(`${PREFIX}/sensor/ideas_attr`, { ideas });
}

export function publishSocial(run: SocialRun) {
  const top = run.emerging[0]?.ticker ?? "none";
  const attr = {
    source: run.source,
    thread: run.threadTitle,
    thread_kind: run.threadKind,
    schedule: run.schedule,
    comments: run.comments,
    window_hours: run.windowHours,
    window_comments: run.windowComments,
    tickers_24h: run.tickers24h,
    emerging: run.emerging,
    emerging_by_sub: run.emergingBySub,
    staples: run.staples,
    tickers: run.tickers,
    quotes: run.quotes,
    sentiment: run.sentiment,
    storage: run.storage,
    errors: run.errors,
  };
  const key = run.source === "wsb_daily" ? "reddit_wsb" : "reddit_subs";
  const sent = run.sentiment;
  const spikes = (run.tickers24h ?? []).filter((t) => t.spike).length;
  pub(
    `${PREFIX}/sensor/${key}`,
    `${run.windowComments ?? run.comments} cmt 24h · ${(run.tickers24h ?? []).length} tkr · ${spikes} pico · B${sent.bull}/R${sent.bear}`,
  );
  pub(`${PREFIX}/sensor/${key}_attr`, attr);
  pub(`${PREFIX}/sensor/reddit_emerging`, top);
  pub(`${PREFIX}/sensor/reddit_emerging_attr`, {
    tickers: run.emerging,
    by_sub: run.emergingBySub,
    source: run.source,
  });
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

export function publishTextState(drafts: MqttDrafts) {
  pub(`${PREFIX}/text/nuevo_ticker`, drafts.ticker);
  pub(`${PREFIX}/text/idea_titulo`, drafts.ideaTitle);
  pub(`${PREFIX}/text/idea_claim`, drafts.ideaClaim);
  pub(`${PREFIX}/select/idea_factor`, drafts.ideaFactor || "iran");
  pub(`${PREFIX}/select/ticker_categoria`, drafts.category || "watchlist");
  pub(`${PREFIX}/number/invertido`, String(drafts.investedUsd ?? 0));
  pub(`${PREFIX}/number/fair_price`, String(drafts.fairPrice ?? 0));
}
