import { FormEvent, useEffect, useMemo, useState } from "react";

type Why = { text: string; kind: string; weight: number };
type Alert = {
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
type Job = {
  id: string;
  letter?: string;
  name: string;
  description: string;
  lastRunAt: string | null;
  lastStatus: string;
  lastError: string | null;
  lastNote: string | null;
};
type Idea = {
  id: string;
  title: string;
  claim: string;
  factorId: string;
  verdict: "open" | "supported" | "refuted" | "mixed";
  evidence: { text: string; url?: string; direction: string }[];
  updatedAt: string;
};
type State = {
  regime: string;
  regimeWhy: Record<string, number>;
  jobs: Job[];
  tickers: { symbol: string; name: string; sector: string }[];
  factors: { id: string; label: string }[];
  ideas: Idea[];
  quotes: { symbol: string; price: number; changePct: number; volumeRatio: number }[];
  alerts: Alert[];
  lastAlert: Alert | null;
  digest: string | null;
  digestAt: string | null;
  news: { title: string; url: string; tier: string; source: string }[];
  disclaimer: string;
};

const verdictColor: Record<Idea["verdict"], string> = {
  open: "bg-white/10 text-ha-muted",
  supported: "bg-ha-green/20 text-ha-green",
  refuted: "bg-ha-red/20 text-ha-red",
  mixed: "bg-ha-amber/20 text-ha-amber",
};

const regimeColor: Record<string, string> = {
  NORMAL: "bg-ha-green",
  WATCH: "bg-ha-amber",
  "HIGH ALERT": "bg-orange-600",
  CRISIS: "bg-ha-red",
};

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [title, setTitle] = useState("");
  const [claim, setClaim] = useState("");
  const [factor, setFactor] = useState("iran");

  async function load() {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, []);

  async function run(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/jobs/${encodeURIComponent(id)}/run?wait=0`, { method: "POST" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function addTicker(e: FormEvent) {
    e.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;
    setBusy("ticker");
    try {
      const res = await fetch("/api/tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTicker("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function addIdea(e: FormEvent) {
    e.preventDefault();
    setBusy("idea");
    try {
      await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, claim, factorId: factor }),
      });
      setTitle("");
      setClaim("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const quoteMap = useMemo(() => {
    const m = new Map<string, { price: number; changePct: number; volumeRatio: number }>();
    for (const q of state?.quotes ?? []) m.set(q.symbol, q);
    return m;
  }, [state]);

  if (!state && error) {
    return (
      <div className="p-8 text-ha-red">
        No se pudo hablar con el worker: {error}. ¿Está corriendo <code>npm run dev:worker</code>?
      </div>
    );
  }
  if (!state) return <div className="p-8 text-ha-muted">Cargando radar…</div>;

  const alert = state.lastAlert;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div className="rounded-xl border border-ha-amber/40 bg-ha-amber/10 px-4 py-3 text-sm text-ha-amber">
        Maqueta de Lovelace — no es la UI de producción. En el mini PC esto vive dentro de Home Assistant (Mushroom / cards nativas).
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-ha-muted">Home Assistant · Centinela</p>
          <h1 className="text-2xl font-medium">Radar de mercado</h1>
        </div>
        <div className={`rounded-full px-4 py-1.5 text-sm font-medium text-white ${regimeColor[state.regime] ?? "bg-slate-600"}`}>
          {state.regime}
        </div>
      </header>

      <section className="rounded-2xl bg-ha-card p-4 shadow-lg border border-ha-border">
        <h2 className="text-sm text-ha-muted mb-2">Ahora</h2>
        {alert ? (
          <div>
            <h3 className="text-lg font-medium break-words">{alert.title}</h3>
            <p className="text-sm text-ha-muted mt-1">
              Score {alert.score}/10 · confianza {alert.confidence}% · {alert.jobIds.join(", ")} · {fmtTime(alert.createdAt)}
            </p>
            <details open className="mt-3 rounded-xl border border-ha-green/40 bg-ha-green/5 p-3">
              <summary className="cursor-pointer text-sm font-medium text-ha-green">
                ¿Por qué me estás alertando? ({alert.why.length} checks)
              </summary>
              <div className="mt-2 space-y-1">
                {alert.why.map((w, i) => (
                  <label key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 text-ha-green">✓</span>
                    <span>
                      {w.text}
                      <span className="ml-1 text-xs text-ha-muted">[{w.kind}]</span>
                    </span>
                  </label>
                ))}
              </div>
            </details>
            {alert.sources.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-ha-accent">
                {alert.sources.map((s) => (
                  <li key={s.url} className="break-words">
                    <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                      [{s.tier}] {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {alert.enrichText && <p className="mt-3 text-sm whitespace-pre-wrap text-ha-muted">{alert.enrichText}</p>}
          </div>
        ) : (
          <p className="text-ha-muted">Sin eventos materiales sobre el umbral de {state.regime}.</p>
        )}
        {state.alerts.length > 1 && (
          <div className="mt-4 border-t border-ha-border pt-3 space-y-2">
            <p className="text-xs uppercase tracking-wider text-ha-muted">Alertas anteriores</p>
            {state.alerts.slice(1, 5).map((a) => (
              <details key={a.id} className="rounded-lg border border-ha-border bg-black/20 p-2">
                <summary className="cursor-pointer text-sm">
                  {a.title} · {a.score}/10
                </summary>
                <ul className="mt-2 space-y-1 text-xs">
                  {a.why.map((w, i) => (
                    <li key={i}>✓ {w.text}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-sm text-ha-muted mb-3">Tickers de interés</h2>
        <div className="flex flex-wrap gap-2">
          {state.tickers.map((t) => {
            const q = quoteMap.get(t.symbol);
            const up = (q?.changePct ?? 0) >= 0;
            return (
              <span key={t.symbol} className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm border border-ha-border">
                <span className="font-medium">{t.symbol}</span>
                {q && (
                  <span className={up ? "text-ha-green" : "text-ha-red"}>
                    {q.changePct >= 0 ? "+" : ""}
                    {q.changePct.toFixed(1)}%
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <form onSubmit={addTicker} className="mt-4 flex flex-col sm:flex-row sm:items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-ha-muted">
            Símbolo
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="CRM"
              aria-label="Símbolo del ticker"
              autoComplete="off"
              className="rounded-lg bg-[#111318] border-2 border-ha-accent/60 px-3 py-2 text-sm text-ha-text w-full sm:w-40"
            />
          </label>
          <button
            type="submit"
            disabled={busy === "ticker" || ticker.trim().length < 1}
            className="rounded-lg bg-ha-accent px-3 py-2 text-sm text-black font-medium disabled:opacity-40"
          >
            Añadir ticker
          </button>
        </form>
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border space-y-3">
        <h2 className="text-sm text-ha-muted">Ideas de mercado (guías)</h2>
        {state.ideas.map((idea) => (
          <article key={idea.id} className="rounded-xl border border-ha-border bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">{idea.title}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${verdictColor[idea.verdict]}`}>{idea.verdict}</span>
            </div>
            <p className="text-sm text-ha-muted mt-1">{idea.claim}</p>
            <p className="text-xs text-ha-muted mt-1">Factor {idea.factorId}</p>
            <p className="text-xs text-ha-muted mt-2">Evidencia de la idea (▲ a favor / ▼ en contra), no es el WHY de la alerta:</p>
            {idea.evidence?.slice(0, 3).map((ev, i) => (
              <p key={i} className="text-xs mt-1 break-words">
                {ev.direction === "support" ? "▲" : "▼"} {ev.text}
              </p>
            ))}
          </article>
        ))}
        <form onSubmit={addIdea} className="grid gap-2 sm:grid-cols-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (Guerra Irán)" className="rounded-lg bg-black/30 border border-ha-border px-3 py-2 text-sm" />
          <select value={factor} onChange={(e) => setFactor(e.target.value)} className="rounded-lg bg-black/30 border border-ha-border px-3 py-2 text-sm">
            {state.factors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="Claim (máx. 255): Trump perdió el control…"
            className="rounded-lg bg-black/30 border border-ha-border px-3 py-2 text-sm sm:col-span-2"
          />
          <button disabled={busy === "idea"} className="rounded-lg bg-ha-accent px-3 py-2 text-sm text-black font-medium sm:col-span-2">
            Guardar idea
          </button>
        </form>
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-sm text-ha-muted mb-3">Tareas</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {state.jobs.map((job) => (
            <div key={job.id} className="flex items-start justify-between gap-2 rounded-xl border border-ha-border bg-black/20 p-3">
              <div>
                <p className="font-medium text-sm">
                  {job.letter ? `${job.letter}. ` : ""}
                  {job.name}
                </p>
                <p className="text-xs text-ha-muted">{job.description}</p>
                <p className="text-xs mt-1">
                  <span
                    className={
                      job.lastStatus === "ok"
                        ? "text-ha-green"
                        : job.lastStatus === "error"
                          ? "text-ha-red"
                          : job.lastStatus === "running"
                            ? "text-ha-accent"
                            : "text-ha-muted"
                    }
                  >
                    {job.lastStatus}
                  </span>
                  {" · "}
                  {fmtTime(job.lastRunAt)}
                </p>
                {job.lastNote && <p className="text-xs text-ha-muted mt-1">{job.lastNote}</p>}
                {job.lastError && <p className="text-xs text-ha-red mt-1">{job.lastError}</p>}
              </div>
              <button
                onClick={() => void run(job.id)}
                disabled={busy === job.id}
                className="shrink-0 rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
              >
                Run
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-sm text-ha-muted mb-2">Briefing</h2>
        <pre className="whitespace-pre-wrap text-sm text-ha-muted">{state.digest || "Aún no hay digest. Corre la tarea Briefing 2h."}</pre>
        <p className="text-xs text-ha-muted mt-2">{fmtTime(state.digestAt)}</p>
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-sm text-ha-muted mb-2">Headlines recientes</h2>
        {state.news.length === 0 && <p className="text-ha-muted text-sm">Vacío — los feeds aún no corrieron o fallaron.</p>}
        <ul className="space-y-2">
          {state.news.slice(0, 12).map((n) => (
            <li key={n.url} className="text-sm">
              <span className="text-xs text-ha-accent mr-2">{n.tier}</span>
              <a href={n.url} className="hover:underline" target="_blank" rel="noreferrer">
                {n.title}
              </a>
              <span className="text-xs text-ha-muted"> · {n.source}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-ha-muted pb-8">{state.disclaimer}</p>
    </div>
  );
}
