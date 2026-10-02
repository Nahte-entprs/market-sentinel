import { useMemo, useState } from "react";
import { post } from "./api";
import { fmtTime, regimeColor, type AppState } from "./types";

export function Radar({ state, onReload }: { state: AppState; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const alert = state.lastAlert;

  async function run(id: string) {
    setBusy(id);
    try {
      await post(`api/jobs/${encodeURIComponent(id)}/run?wait=0`, {});
      await onReload();
    } finally {
      setBusy(null);
    }
  }

  const jobs = useMemo(
    () =>
      state.jobs.filter((j) =>
        ["macro.scan", "ticker.events", "market.sentiment", "volume.unusual", "reddit.rising", "reddit.subs", "quotes.poll", "fundamentals.poll", "ideas.eval", "digest.brief"].includes(j.id),
      ),
    [state.jobs],
  );

  return (
    <div className="space-y-3 pb-4">
      <header className="flex items-center justify-between gap-3 pt-1">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-ha-muted">Centinela</p>
          <h1 className="text-xl font-medium">Radar</h1>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-medium text-white ${regimeColor[state.regime] ?? "bg-slate-600"}`}>
          {state.regime}
        </div>
      </header>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-xs text-ha-muted mb-2">Ahora</h2>
        {alert ? (
          <div>
            <h3 className="text-base font-medium break-words">{alert.title}</h3>
            <p className="text-xs text-ha-muted mt-1">
              {alert.score}/10 · {alert.confidence}% · {fmtTime(alert.createdAt)}
            </p>
            <ul className="mt-3 space-y-1.5">
              {alert.why.map((w, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-ha-green">✓</span>
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-ha-muted text-sm">Sin eventos sobre el umbral ({state.threshold}).</p>
        )}
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-xs text-ha-muted mb-2">Briefing</h2>
        <pre className="whitespace-pre-wrap text-sm text-ha-muted">{state.digest || "Aún no hay briefing."}</pre>
        <p className="text-[11px] text-ha-muted mt-2">{fmtTime(state.digestAt)}</p>
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-xs text-ha-muted mb-2">Headlines</h2>
        {state.news.length === 0 && <p className="text-ha-muted text-sm">Vacío — los feeds aún no corrieron.</p>}
        <ul className="space-y-2">
          {state.news.slice(0, 8).map((n) => (
            <li key={n.url} className="text-sm">
              <span className="text-[11px] text-ha-accent mr-2">{n.tier}</span>
              <a href={n.url} className="hover:underline" target="_blank" rel="noreferrer">
                {n.title}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-ha-card p-4 border border-ha-border">
        <h2 className="text-xs text-ha-muted mb-3">Tareas</h2>
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-start justify-between gap-2 rounded-xl border border-ha-border bg-ha-inset p-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">
                  {job.letter ? `${job.letter}. ` : ""}
                  {job.name}
                </p>
                <p className="text-[11px] text-ha-muted truncate">{job.lastNote || job.description}</p>
                <p className="text-[11px] mt-0.5">
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
                {job.lastError && <p className="text-[11px] text-ha-red mt-1">{job.lastError}</p>}
              </div>
              <button
                type="button"
                onClick={() => void run(job.id)}
                disabled={busy === job.id}
                className="shrink-0 rounded-lg bg-ha-text/10 px-2 py-1 text-xs hover:bg-ha-text/20"
              >
                Run
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
