import { post } from "./api";
import type { AppState, SocialRun } from "./types";

function Climate({ run }: { run: SocialRun }) {
  const s = run.sentiment;
  return (
    <div className="space-y-1 text-sm">
      <p>
        Alcista {s.pct_bull}% <span className="text-ha-green">{s.bar_bull}</span> ({s.bull})
      </p>
      <p>
        Bajista {s.pct_bear}% <span className="text-ha-red">{s.bar_bear}</span> ({s.bear})
      </p>
      <p className="text-ha-muted">
        Neutro {s.pct_flat}% {s.bar_flat} ({s.unlabeled})
      </p>
    </div>
  );
}

function Block({ title, run, onRun, busy }: { title: string; run: SocialRun | null; onRun: () => void; busy: boolean }) {
  return (
    <section className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="text-[11px] text-ha-muted">{run?.threadTitle || "Sin hilo aún. Corre la tarea."}</p>
        </div>
        <button type="button" onClick={onRun} disabled={busy} className="shrink-0 rounded-lg bg-white/10 px-2 py-1 text-xs">
          Run
        </button>
      </div>
      {!run && <p className="text-sm text-ha-muted">Todavía no hay captura en este dispositivo.</p>}
      {run && (
        <>
          <p className="text-[11px] text-ha-muted">
            Hilo {run.threadKind} · {run.comments} cmt · {run.schedule}
          </p>
          <Climate run={run} />
          <div>
            <h3 className="text-xs text-ha-muted mb-1">Emergentes</h3>
            {(!run.emergingBySub || run.emergingBySub.length === 0) && <p className="text-sm text-ha-muted">Ningún ticker listado en pico.</p>}
            {run.emergingBySub?.map((b) => (
              <div key={b.sub} className="mb-2">
                <p className="text-xs font-medium">r/{b.sub}</p>
                {b.tickers.map((t) => (
                  <p key={t.ticker} className="text-sm">
                    <span className="font-medium">{t.ticker}</span> · {t.comments} cmt
                    {t.ratio7d ? ` · ×${t.ratio7d.toFixed(1)}` : ""}
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div>
            <h3 className="text-xs text-ha-muted mb-1">Comentarios retenidos</h3>
            {(!run.quotes || run.quotes.length === 0) && <p className="text-sm text-ha-muted">Nada con flag ok y texto largo.</p>}
            <div className="space-y-3">
              {run.quotes?.slice(0, 12).map((q, i) => (
                <article key={`${q.ticker}-${i}`} className="rounded-xl bg-black/20 p-3 text-sm">
                  <p className="text-xs text-ha-muted">
                    {q.ticker} · score {q.score}
                    {q.sub ? ` · r/${q.sub}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{q.body}</p>
                </article>
              ))}
            </div>
          </div>
          {run.storage && (
            <p className="text-[11px] text-ha-muted">
              Archivo {run.storage.comments} comentarios · {run.storage.keepDays} días
              {run.storage.oldestNyDay ? ` · desde ${run.storage.oldestNyDay}` : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function Reddit({ state, onReload }: { state: AppState; onReload: () => Promise<void> }) {
  async function run(id: string) {
    await post(`api/jobs/${encodeURIComponent(id)}/run?wait=0`, {});
    await onReload();
  }
  return (
    <div className="space-y-4 pb-4">
      <header className="pt-1">
        <p className="text-[11px] uppercase tracking-widest text-ha-muted">Social</p>
        <h1 className="text-xl font-medium">Reddit</h1>
      </header>
      <p className="text-xs text-ha-muted">Palabras sueltas, no sarcasmo. No es consejo financiero.</p>
      <Block title="r/wallstreetbets" run={state.reddit?.wsb ?? null} busy={false} onRun={() => void run("reddit.rising")} />
      <Block title="Otros subs" run={state.reddit?.subs ?? null} busy={false} onRun={() => void run("reddit.subs")} />
    </div>
  );
}
