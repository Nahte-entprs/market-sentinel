import { useEffect, useState } from "react";
import { api } from "./api";
import { fmtTime, type AppState, type CommentPage, type TickerPace } from "./types";

type Source = "wsb" | "subs";

function visibleTickers(rows: TickerPace[], minMentions: number, maxTickers: number): TickerPace[] {
  const rank = { up: 0, flat: 1, down: 2 };
  return rows
    .filter((t) => t.comments >= minMentions)
    .sort(
      (a, b) =>
        rank[a.trend ?? "flat"] - rank[b.trend ?? "flat"] ||
        (b.paceDelta ?? 0) - (a.paceDelta ?? 0) ||
        b.comments - a.comments,
    )
    .slice(0, maxTickers);
}

function TrendMark({ trend }: { trend?: TickerPace["trend"] }) {
  if (trend === "up") return <span className="text-ha-green font-medium" aria-label="Surgiendo">↑</span>;
  if (trend === "down") return <span className="text-ha-red font-medium" aria-label="Perdiendo impulso">↓</span>;
  return <span className="text-ha-muted" aria-label="Manteniendo">–</span>;
}

export function Reddit({ state }: { state: AppState; onReload: () => Promise<void> }) {
  const [source, setSource] = useState<Source>("wsb");
  const [picked, setPicked] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<CommentPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = source === "wsb" ? state.reddit?.wsb : state.reddit?.subs;
  const cfg = state.settings.reddit;
  const rows = visibleTickers(run?.tickers24h ?? [], cfg.minMentions, cfg.maxTickers);
  const sent = run?.sentiment;
  const n = run?.windowComments ?? (sent ? sent.bull + sent.bear + sent.unlabeled : 0);
  const pctBull = sent?.pct_bull ?? 0;
  const pctBear = sent?.pct_bear ?? 0;
  const pctFlat = sent?.pct_flat ?? 0;

  useEffect(() => {
    setPicked(null);
    setOffset(0);
    setPage(null);
  }, [source]);

  useEffect(() => {
    if (picked === null) return;
    let cancel = false;
    setLoading(true);
    setErr(null);
    const q = `api/reddit/comments?source=${source}&ticker=${encodeURIComponent(picked)}&offset=${offset}`;
    api<CommentPage>(q)
      .then((p) => {
        if (!cancel) setPage(p);
      })
      .catch((e: Error) => {
        if (!cancel) setErr(e.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [picked, offset, source, cfg.minChars, cfg.maxChars, cfg.blockText, cfg.pageSize]);

  function choose(ticker: string) {
    setOffset(0);
    setPicked((cur) => (cur === ticker ? null : ticker));
  }

  const more = page != null && page.offset + page.comments.length < page.total;

  return (
    <div className="space-y-4 pb-4">
      <header className="pt-1">
        <p className="text-[11px] uppercase tracking-widest text-ha-muted">Social</p>
        <h1 className="text-xl font-medium">Reddit</h1>
      </header>

      <section className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">24 h</h2>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSource("wsb")}
              className={`rounded-lg px-3 py-1 text-xs ${source === "wsb" ? "bg-ha-accent text-ha-onaccent font-medium" : "bg-ha-inset"}`}
            >
              WSB
            </button>
            <button
              type="button"
              onClick={() => setSource("subs")}
              className={`rounded-lg px-3 py-1 text-xs ${source === "subs" ? "bg-ha-accent text-ha-onaccent font-medium" : "bg-ha-inset"}`}
            >
              Subs
            </button>
          </div>
        </div>
        <p className="text-sm tabular-nums">{n.toLocaleString("es-CL")} comentarios en la ventana (24 h)</p>
        <div className="flex h-3.5 overflow-hidden rounded-full bg-ha-inset">
          <div className="bg-ha-green" style={{ width: `${pctBull}%` }} />
          <div className="bg-ha-red" style={{ width: `${pctBear}%` }} />
          <div className="bg-ha-muted/35" style={{ width: `${pctFlat}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-medium tabular-nums text-ha-green leading-tight">{pctBull}%</p>
            <p className="text-[11px] text-ha-muted">Alcista · {sent?.bull ?? 0}</p>
          </div>
          <div>
            <p className="text-lg font-medium tabular-nums text-ha-red leading-tight">{pctBear}%</p>
            <p className="text-[11px] text-ha-muted">Bajista · {sent?.bear ?? 0}</p>
          </div>
          <div>
            <p className="text-lg font-medium tabular-nums text-ha-muted leading-tight">{pctFlat}%</p>
            <p className="text-[11px] text-ha-muted">Neutro · {sent?.unlabeled ?? 0}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <h2 className="font-medium mb-2">Tickers</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ha-muted">Sin tickers en esta ventana.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-ha-muted">
                <th className="w-4 pb-1" />
                <th className="text-left font-normal pb-1">Ticker</th>
                <th className="text-right font-normal pb-1 w-10">1 h</th>
                <th className="text-right font-normal pb-1 w-10">3 h</th>
                <th className="text-right font-normal pb-1 w-10">24 h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const on = picked === t.ticker;
                return (
                  <tr
                    key={t.ticker}
                    onClick={() => choose(t.ticker)}
                    className={`cursor-pointer border-t border-ha-border ${on ? "bg-ha-inset" : ""}`}
                  >
                    <td className="py-1.5 text-center"><TrendMark trend={t.trend} /></td>
                    <td className="py-1.5 font-medium">{t.ticker}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.last1h}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.last3h}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.comments}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-3">
        <h2 className="font-medium">Comentarios</h2>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => choose("")}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${picked === "" ? "bg-ha-accent text-ha-onaccent font-medium" : "bg-ha-inset"}`}
          >
            Sin ticker
          </button>
          {rows.map((t) => (
            <button
              key={t.ticker}
              type="button"
              onClick={() => choose(t.ticker)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs ${picked === t.ticker ? "bg-ha-accent text-ha-onaccent font-medium" : "bg-ha-inset"}`}
            >
              {t.ticker}
            </button>
          ))}
        </div>
        {picked === null && <p className="text-sm text-ha-muted">Elige un ticker.</p>}
        {picked !== null && err && <p className="text-sm text-ha-red">{err}</p>}
        {picked !== null && loading && !page && <p className="text-sm text-ha-muted">Cargando…</p>}
        {picked !== null && page && page.comments.length === 0 && !loading && (
          <p className="text-sm text-ha-muted">Sin comentarios.</p>
        )}
        {picked !== null && page && page.comments.length > 0 && (
          <div className="space-y-2">
            {page.comments.map((q, i) => (
              <article key={`${q.created ?? ""}-${i}`} className="rounded-xl bg-ha-inset p-3 text-sm">
                <p className="text-[11px] text-ha-muted">
                  {q.author && q.author !== "[deleted]" ? `u/${q.author}` : "sin usuario"}
                  {q.authorFlair ? ` · ${q.authorFlair}` : ""}
                  {q.created ? ` · ${fmtTime(q.created)}` : ""}
                  {q.sub ? ` · r/${q.sub}` : ""}
                </p>
                {q.postTitle || q.postUrl ? (
                  q.postUrl ? (
                    <a href={q.postUrl} target="_blank" rel="noreferrer" className="text-[11px] text-ha-accent hover:underline">
                      {q.postTitle || "Post"}
                    </a>
                  ) : (
                    <p className="text-[11px] text-ha-muted">{q.postTitle}</p>
                  )
                ) : null}
                <p className="mt-1 whitespace-pre-wrap break-words">{q.body}</p>
              </article>
            ))}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[11px] text-ha-muted tabular-nums">
                {page.offset + 1}–{page.offset + page.comments.length} de {page.total.toLocaleString("es-CL")}
              </p>
              <div className="flex gap-1">
                {page.offset > 0 && (
                  <button
                    type="button"
                    onClick={() => setOffset(Math.max(0, page.offset - page.limit))}
                    className="rounded-lg bg-ha-inset px-2 py-1 text-xs"
                  >
                    Anterior
                  </button>
                )}
                {more && (
                  <button
                    type="button"
                    onClick={() => setOffset(page.offset + page.limit)}
                    className="rounded-lg bg-ha-accent px-2 py-1 text-xs text-ha-onaccent font-medium"
                  >
                    Siguientes
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
