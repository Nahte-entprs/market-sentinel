import { useRef, useState, type ReactNode } from "react";
import { del, post } from "./api";
import type { AppState, Category, Position } from "./types";

const LABELS: Record<Category, string> = {
  holding: "Holding",
  priority: "Priority",
  watchlist: "Watchlist",
};

const SECTION: Record<Category, { tone: string; wash: string; ink: string }> = {
  holding: {
    tone: "var(--sec-hold)",
    wash: "color-mix(in srgb, var(--sec-hold) 16%, transparent)",
    ink: "var(--sec-hold)",
  },
  priority: {
    tone: "var(--sec-prio)",
    wash: "color-mix(in srgb, var(--sec-prio) 18%, transparent)",
    ink: "var(--sec-prio)",
  },
  watchlist: {
    tone: "var(--sec-watch)",
    wash: "color-mix(in srgb, var(--sec-watch) 16%, transparent)",
    ink: "var(--sec-watch)",
  },
};

function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "expensive" | "cheap" | "hot" | "fade" }) {
  const style =
    tone === "expensive"
      ? { background: "color-mix(in srgb, var(--c-red) 18%, transparent)", color: "var(--c-red)" }
      : tone === "cheap"
        ? { background: "color-mix(in srgb, var(--c-green) 18%, transparent)", color: "var(--c-green)" }
        : tone === "hot"
          ? { background: "color-mix(in srgb, var(--c-amber) 22%, transparent)", color: "var(--c-amber)" }
          : tone === "fade"
            ? { background: "color-mix(in srgb, var(--c-text) 12%, transparent)", color: "var(--c-text)" }
            : { background: "var(--c-card)", color: "var(--c-muted)" };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums" style={style}>
      {children}
    </span>
  );
}

function ratioLabel(ratio: number | null, samples: number) {
  if (ratio == null || samples < 5) return samples > 0 ? `n/d (${samples}d)` : "n/d";
  return `${ratio.toFixed(1)}×`;
}

function maLabel(days: string, level: number | null, delta: number | null) {
  if (level == null) return `${days} n/d`;
  const px = level.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const pct = delta == null ? "" : ` ${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
  return `${days} ${px}${pct}`;
}

const FOLD_KEY = "centinela.cartera.folded";

function readFolded(): Record<Category, boolean> {
  const empty = { holding: false, priority: false, watchlist: false };
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLD_KEY) || "") as Partial<Record<Category, boolean>>;
    return {
      holding: !!parsed.holding,
      priority: !!parsed.priority,
      watchlist: !!parsed.watchlist,
    };
  } catch {
    return empty;
  }
}

export function Cartera({ state, onReload }: { state: AppState; onReload: () => Promise<void> }) {
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [fairDraft, setFairDraft] = useState("");
  const [sharesDraft, setSharesDraft] = useState("");
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  const [folded, setFolded] = useState<Record<Category, boolean>>(readFolded);

  function toggleSection(cat: Category) {
    setFolded((prev) => {
      const next = { ...prev, [cat]: !prev[cat] };
      localStorage.setItem(FOLD_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function addTo(category: Category) {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    setBusy(true);
    try {
      await post("api/tickers", { symbol: s, category });
      setSymbol("");
      setFolded((prev) => {
        const next = { ...prev, [category]: false };
        localStorage.setItem(FOLD_KEY, JSON.stringify(next));
        return next;
      });
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function saveRow(p: Position) {
    setBusy(true);
    try {
      const fair = fairDraft.trim() === "" ? (p.fair ?? 0) : Number(fairDraft);
      const shares = sharesDraft.trim() === "" ? p.shares : Number(sharesDraft);
      await post("api/tickers", {
        symbol: p.symbol,
        category: p.category,
        fairPrice: Number.isFinite(fair) ? fair : p.fair ?? 0,
        shares: Number.isFinite(shares) ? shares : p.shares,
      });
      setOpen(null);
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(sym: string) {
    setBusy(true);
    try {
      await del(`api/tickers/${encodeURIComponent(sym)}`);
      setConfirm(null);
      setOpen(null);
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function move(sym: string, dir: "up" | "down") {
    setBusy(true);
    try {
      await post(`api/tickers/${encodeURIComponent(sym)}/move`, { dir });
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  function startHold(sym: string) {
    stopHold();
    held.current = false;
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      setConfirm(sym);
    }, 520);
  }
  function stopHold() {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function toggle(p: Position) {
    if (held.current) {
      held.current = false;
      return;
    }
    if (open === p.symbol) {
      setOpen(null);
      return;
    }
    setOpen(p.symbol);
    setFairDraft(p.fair != null ? String(p.fair) : "");
    setSharesDraft(p.shares ? String(p.shares) : "");
  }

  function list(cat: Category): Position[] {
    if (cat === "holding") return state.cartera.holding;
    if (cat === "priority") return state.cartera.priority;
    return state.cartera.watch;
  }

  return (
    <div className="space-y-4 pb-4">
      <header className="pt-1">
        <p className="text-[11px] uppercase tracking-widest text-ha-muted">Acciones</p>
        <h1 className="text-xl font-medium">Cartera</h1>
        <p className="mt-1 text-[11px] leading-snug text-ha-muted">
          Fair es cuánto está el precio por encima (rojo) o por debajo (verde) de tu valor justo. Las medias dicen lo mismo contra 50, 100 y 200 días. Ritmo y 5m comparan el volumen de hoy, en horario de mercado, con la misma hora de los últimos 14 días. Ámbar es volumen al alza; «bajo» es que el ticker está perdiendo impulso.
        </p>
      </header>

      <div className="rounded-2xl border border-ha-border bg-ha-card p-3">
        <label className="text-[11px] text-ha-muted">Ticker</label>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="NVDA"
          autoComplete="off"
          autoCapitalize="characters"
          className="mt-1 w-full rounded-xl bg-ha-input border border-ha-accent/50 px-3 py-2.5 text-base tracking-wide"
        />
      </div>

      {(["holding", "priority", "watchlist"] as Category[]).map((cat) => {
        const sec = SECTION[cat];
        const rows = list(cat);
        const closed = folded[cat];
        return (
        <section
          key={cat}
          className="rounded-2xl border bg-ha-card overflow-hidden"
          style={{ borderColor: `color-mix(in srgb, ${sec.tone} 55%, var(--c-border))` }}
        >
          <div className="flex items-center gap-2 px-2 py-2" style={{ background: sec.wash }}>
            <button
              type="button"
              onClick={() => toggleSection(cat)}
              aria-expanded={!closed}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1 text-left"
            >
              <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: sec.tone }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold uppercase tracking-wide" style={{ color: sec.ink }}>
                  {LABELS[cat]}
                </span>
                <span className="block text-[11px] text-ha-muted">
                  {cat === "holding" ? "Por valor de mercado" : "Orden manual"}
                  {rows.length ? ` · ${rows.length}` : ""}
                </span>
              </span>
              <span className="px-1 text-sm text-ha-muted" aria-hidden>
                {closed ? "▸" : "▾"}
              </span>
            </button>
            <button
              type="button"
              disabled={busy || symbol.trim().length < 1}
              onClick={() => void addTo(cat)}
              className="h-9 w-9 shrink-0 rounded-full text-xl leading-none disabled:opacity-30"
              style={{ background: sec.tone, color: "var(--c-bg)" }}
              aria-label={`Añadir a ${LABELS[cat]}`}
            >
              +
            </button>
          </div>
          {closed ? null : rows.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ha-muted">Vacío.</p>
          ) : (
          <ul className="space-y-2 px-2 py-2">
            {rows.map((p) => {
              const up = (p.change_pct ?? 0) >= 0;
              const expanded = open === p.symbol;
              const band = state.settings.cartera[cat];
              const fairUp = (p.fair_delta_pct ?? 0) > 0;
              const fairDown = (p.fair_delta_pct ?? 0) < 0;
              const paceHot = p.pace_ratio != null && p.pace_samples >= 5 && p.pace_ratio >= band.sessionPaceRatio;
              const paceFade = p.pace_ratio != null && p.pace_samples >= 5 && p.pace_ratio <= band.sessionFadeRatio;
              const burstHot = p.burst_ratio != null && p.burst_samples >= 5 && p.burst_ratio >= band.intradayVolumeRatio;
              const paceWord = p.session_done ? "día" : "ritmo";
              return (
                <li key={p.symbol} className="rounded-xl border border-ha-border bg-ha-inset">
                  <div
                    className="flex items-stretch"
                    onPointerDown={() => startHold(p.symbol)}
                    onPointerUp={stopHold}
                    onPointerCancel={stopHold}
                    onPointerLeave={stopHold}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      className="flex-1 text-left px-3 py-3 min-w-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-base font-semibold tracking-wide">{p.symbol}</p>
                          {(p.shares > 0 || cat === "holding") && (
                            <p className="mt-0.5 text-xs text-ha-muted">
                              {p.shares > 0 ? (
                                <>
                                  {p.shares_fmt} acc
                                  {p.market_value_fmt ? <span className="text-ha-text"> · {p.market_value_fmt}</span> : null}
                                </>
                              ) : (
                                "Sin acciones"
                              )}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-base font-medium tabular-nums">{p.price_fmt}</p>
                          {p.change_fmt ? (
                            <p className={`text-xs font-medium tabular-nums ${up ? "text-ha-green" : "text-ha-red"}`}>{p.change_fmt}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {p.fair_fmt ? (
                          <Chip tone={fairUp ? "expensive" : fairDown ? "cheap" : "neutral"}>
                            Fair {p.fair_fmt} {p.fair_delta_fmt}
                          </Chip>
                        ) : (
                          <Chip>sin fair</Chip>
                        )}
                        <Chip>
                          {p.rec_label}
                          {p.analyst_count ? ` (${p.analyst_count})` : ""}
                        </Chip>
                        {p.target_fmt ? <Chip>PT {p.target_fmt}</Chip> : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Chip>{maLabel("50d", p.ma50, p.ma50_delta_pct)}</Chip>
                        <Chip>{maLabel("100d", p.ma100, p.ma100_delta_pct)}</Chip>
                        <Chip>{maLabel("200d", p.ma200, p.ma200_delta_pct)}</Chip>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Chip tone={paceHot ? "hot" : paceFade ? "fade" : "neutral"}>
                          {paceWord} {ratioLabel(p.pace_ratio, p.pace_samples)}
                          {paceFade ? " bajo" : ""}
                        </Chip>
                        <Chip tone={burstHot ? "hot" : "neutral"}>5m {ratioLabel(p.burst_ratio, p.burst_samples)}</Chip>
                        <Chip>{p.week52_line}</Chip>
                      </div>
                    </button>
                    {cat !== "holding" && (
                      <div className="flex flex-col border-l border-ha-border">
                        <button
                          type="button"
                          className="px-2.5 flex-1 text-ha-muted hover:text-ha-text"
                          onClick={() => void move(p.symbol, "up")}
                          aria-label="Subir"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="px-2.5 flex-1 text-ha-muted hover:text-ha-text"
                          onClick={() => void move(p.symbol, "down")}
                          aria-label="Bajar"
                        >
                          ▼
                        </button>
                      </div>
                    )}
                  </div>
                  {expanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-ha-border">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-ha-muted">
                          Fair
                          <input
                            value={fairDraft}
                            onChange={(e) => setFairDraft(e.target.value)}
                            inputMode="decimal"
                            className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="text-[11px] text-ha-muted">
                          Acciones
                          <input
                            value={sharesDraft}
                            onChange={(e) => setSharesDraft(e.target.value)}
                            inputMode="decimal"
                            className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveRow(p)}
                          className="rounded-lg bg-ha-accent px-3 py-2 text-sm text-ha-onaccent font-medium"
                        >
                          Guardar
                        </button>
                        <button type="button" onClick={() => setConfirm(p.symbol)} className="rounded-lg bg-ha-text/10 px-3 py-2 text-sm">
                          Quitar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          )}
        </section>
        );
      })}

      {confirm && (
        <div className="fixed inset-0 z-20 bg-black/60 flex items-end justify-center p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-ha-card border border-ha-border p-4 mb-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium">¿Quitar {confirm}?</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="flex-1 rounded-lg bg-ha-text/10 py-2.5 text-sm">
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(confirm)}
                className="flex-1 rounded-lg bg-ha-red py-2.5 text-sm font-medium"
              >
                Quitar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
