import { config } from "./config.ts";
import type { AlertRecord, Candidate } from "./types.ts";

export interface Summarizer {
  name: string;
  summarize(input: Candidate | AlertRecord): Promise<string | null> | string | null;
}

export function templateSummarize(c: Pick<Candidate, "title" | "why" | "score" | "confidence" | "jobIds">): string {
  const lines = c.why.slice(0, 8).map((w) => `• ${w.text}`);
  return `${c.title}\nScore ${c.score.toFixed(1)}/10 · confianza ${Math.round(c.confidence)}% · jobs ${c.jobIds.join(", ")}\n${lines.join("\n")}\nNo es consejo financiero.`;
}

export const TemplateSummarizer: Summarizer = {
  name: "template",
  summarize(input) {
    return templateSummarize(input as Candidate);
  },
};

let lastUsed = 0;
let enrichQueue: AlertRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 10 * 60 * 1000;

async function callOpenAiCompat(url: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          {
            role: "system",
            content:
              "Redacta en español un briefing corto (5-8 viñetas) a partir de hechos dados. No inventes precios. Cita fuentes si vienen. No des consejo financiero.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export const LocalLLM: Summarizer = {
  name: "local-llm",
  async summarize(input) {
    if (!config.llamaServerUrl) return null;
    lastUsed = Date.now();
    const facts = JSON.stringify({
      title: "title" in input ? input.title : "",
      why: "why" in input ? input.why : [],
      score: "score" in input ? input.score : 0,
    }).slice(0, 2500);
    return callOpenAiCompat(config.llamaServerUrl, facts);
  },
};

export const RemoteWorker: Summarizer = {
  name: "remote-worker",
  async summarize(input) {
    if (!config.remoteWorkerUrl) return null;
    try {
      const res = await fetch(`${config.remoteWorkerUrl.replace(/\/$/, "")}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { text?: string };
      return json.text ?? null;
    } catch {
      return null;
    }
  },
};

export async function maybeEnrich(alert: AlertRecord): Promise<string | null> {
  enrichQueue.push(alert);
  const text =
    (await RemoteWorker.summarize(alert)) || (await LocalLLM.summarize(alert));
  lastUsed = Date.now();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (Date.now() - lastUsed >= IDLE_MS) {
      enrichQueue = [];
    }
  }, IDLE_MS);
  return text;
}
