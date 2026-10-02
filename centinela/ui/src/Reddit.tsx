import { post } from "./api";
import type { AppState, CommentQuote, SocialRun, TickerPace } from "./types";

function mergePace(runs: (SocialRun | null | undefined)[]): TickerPace[] {
  const map = new Map<string, TickerPace>();
  for (const run of runs) {
    for (const t of run?.tickers24h ?? []) {
      const cur = map.get(t.ticker);
      if (!cur) {
        map.set(t.ticker, { ...t });
        continue;
      }
      cur.comments += t.comments;
      cur.last1h += t.last1h;
      cur.last3h += t.last3h;
      cur.spike = cur.spike || t.spike;
    }
  }
  return [...map.values()]
    .map((t) => {
      const rest = Math.max(0, t.comments - t.last1h);
      const hourlyAvg = rest / 23;
      const velocity = hourlyAvg >= 0.4 ? t.last1h / hourlyAvg : t.last1h >= 5 ? 20 : t.last1h;
      return { ...t, velocity, spike: t.last1h >= 6 && velocity >= 2.5 };
    })
    .sort((a, b) => Number(b.spike) - Number(a.spike) || b.velocity - a.velocity || b.comments - a.comments);
}

function mergeQuotes(runs: (SocialRun | null | undefined)[]): CommentQuote[] {
  const out: CommentQuote[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (const q of run?.quotes ?? []) {
      const key = q.body.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
  }
  return out;
}

function mergeSentiment(runs: (SocialRun | null | undefined)[]) {
  let bull = 0;
  let bear = 0;
  let unlabeled = 0;
  let n = 0;
  for (const run of runs) {
    if (!run?.sentiment) continue;
    bull += run.sentiment.bull;
    bear += run.sentiment.bear;
    unlabeled += run.sentiment.unlabeled;
    n += run.windowComments ?? 0;
  }
  const tot = Math.max(1, bull + bear + unlabeled);
  return {
    bull,
    bear,
    unlabeled,
    n: n || bull + bear + unlabeled,
    pct_bull: Math.round((bull / tot) * 100),
    pct_bear: Math.round((bear / tot) * 100),
    pct_flat: Math.max(0, 100 - Math.round((bull / tot) * 100) - Math.round((bear / tot) * 100)),
  };
}

function Sentiment({
  bull,
  bear,
  unlabeled,
  pct_bull,
  pct_bear,
  pct_flat,
  n,
}: {
  bull: number;
  bear: number;
  unlabeled: number;
  pct_bull: number;
  pct_bear: number;
  pct_flat: number;
  n: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex h-3.5 overflow-hidden rounded-full bg-ha-inset">
        <div className="bg-ha-green transition-[width]" style={{ width: `${pct_bull}%` }} title={`Alcista ${pct_bull}%`} />
        <div className="bg-ha-red transition-[width]" style={{ width: `${pct_bear}%` }} title={`Bajista ${pct_bear}%`} />
        <div className="bg-ha-muted/35 transition-[width]" style={{ width: `${pct_flat}%` }} title={`Neutro ${pct_flat}%`} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-medium tabular-nums text-ha-green leading-tight">{pct_bull}%</p>
          <p className="text-[11px] text-ha-muted">Alcista · {bull}</p>
        </div>
        <div>
          <p className="text-lg font-medium tabular-nums text-ha-red leading-tight">{pct_bear}%</p>
          <p className="text-[11px] text-ha-muted">Bajista · {bear}</p>
        </div>
        <div>
          <p className="text-lg font-medium tabular-nums text-ha-muted leading-tight">{pct_flat}%</p>
          <p className="text-[11px] text-ha-muted">Neutro · {unlabeled}</p>
        </div>
      </div>
      <p className="text-[11px] text-ha-muted">
        Léxico sobre {n.toLocaleString("es-CL")} comentarios de las últimas 24 h. El archivo de 31 días no entra en estas barras.
      </p>
    </div>
  );
}

function PaceList({ rows }: { rows: TickerPace[] }) {
  const maxC = Math.max(1, ...rows.map((t) => t.comments));
  const maxH = Math.max(1, ...rows.map((t) => t.last1h));
  if (!rows.length) {
    return <p className="text-sm text-ha-muted">Aún no hay menciones con ritmo en esta ventana. Corre las tareas.</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((t) => (
        <li key={t.ticker}>
          <div className="flex items-center gap-2">
            {t.spike ? (
              <span className="shrink-0 rounded px-1 py-0.5 text-[10px] uppercase tracking-wide bg-ha-amber/20 text-ha-amber">pico</span>
            ) : (
              <span className="shrink-0 w-9" />
            )}
            <span className="w-12 font-medium">{t.ticker}</span>
            <span className="tabular-nums text-sm w-8 text-right">{t.comments}</span>
            <div className="flex-1 min-w-0">
              <div className="h-1.5 rounded-full bg-ha-inset overflow-hidden">
                <div className="h-full bg-ha-accent/80" style={{ width: `${(t.comments / maxC) * 100}%` }} />
              </div>
              <div className="h-1 mt-0.5 rounded-full bg-ha-inset overflow-hidden">
                <div className={`h-full ${t.spike ? "bg-ha-amber" : "bg-ha-muted/70"}`} style={{ width: `${(t.last1h / maxH) * 100}%` }} />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-ha-muted mt-0.5 pl-[5.75rem]">
            {t.last1h} última hora · {t.last3h} en 3h · ritmo ×{t.velocity.toFixed(1)} vs el resto del día
          </p>
        </li>
      ))}
    </ul>
  );
}

export function Reddit({ state, onReload }: { state: AppState; onReload: () => Promise<void> }) {
  const wsb = state.reddit?.wsb ?? null;
  const subs = state.reddit?.subs ?? null;
  const runs = [wsb, subs];
  const tickers = mergePace(runs);
  const quotes = mergeQuotes(runs);
  const sent = mergeSentiment(runs);
  const archive = Math.max(wsb?.storage?.comments ?? 0, subs?.storage?.comments ?? 0);
  const keepDays = wsb?.storage?.keepDays ?? subs?.storage?.keepDays ?? 31;
  const oldest = wsb?.storage?.oldestNyDay ?? subs?.storage?.oldestNyDay ?? null;

  async function run(id: string) {
    await post(`api/jobs/${encodeURIComponent(id)}/run?wait=0`, {});
    await onReload();
  }

  return (
    <div className="space-y-4 pb-4">
      <header className="pt-1">
        <p className="text-[11px] uppercase tracking-widest text-ha-muted">Social</p>
        <h1 className="text-xl font-medium">Reddit</h1>
        <p className="text-xs text-ha-muted mt-1">Últimas 24 horas, no el día de calendario. Palabras sueltas, no sarcasmo.</p>
      </header>

      <section className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-medium">Sensación 24 h</h2>
            <p className="text-[11px] text-ha-muted">{sent.n.toLocaleString("es-CL")} comentarios en la ventana</p>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => void run("reddit.rising")} className="rounded-lg bg-ha-inset px-2 py-1 text-xs">
              WSB
            </button>
            <button type="button" onClick={() => void run("reddit.subs")} className="rounded-lg bg-ha-inset px-2 py-1 text-xs">
              Subs
            </button>
          </div>
        </div>
        <Sentiment {...sent} />
        <p className="text-[11px] text-ha-muted">
          Archivo {archive.toLocaleString("es-CL")} comentarios · {keepDays} días
          {oldest ? ` · desde ${oldest}` : ""} — no es el recuento de las barras.
        </p>
      </section>

      <section className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-3">
        <div>
          <h2 className="font-medium">Tickers en 24 h</h2>
          <p className="text-[11px] text-ha-muted">
            Barra superior = menciones totales. Inferior = última hora. Un pico (STX) no queda bajo un total alto (WDC).
          </p>
        </div>
        <PaceList rows={tickers} />
      </section>

      <section className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-3">
        <div>
          <h2 className="font-medium">Comentarios relevantes</h2>
          <p className="text-[11px] text-ha-muted">Textos largos de las últimas 24 h, recientes primero y luego por score.</p>
        </div>
        {quotes.length === 0 && <p className="text-sm text-ha-muted">Nada con texto útil en esta ventana.</p>}
        <div className="space-y-3">
          {quotes.slice(0, 20).map((q, i) => (
            <article key={`${q.ticker}-${i}`} className="rounded-xl bg-ha-inset p-3 text-sm">
              <p className="text-xs text-ha-muted">
                {q.ticker} · score {q.score}
                {q.sub ? ` · r/${q.sub}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{q.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
