import { useRef, useState } from "react";
import { del, post } from "./api";
import type { AppState, Category, Position } from "./types";

const LABELS: Record<Category, string> = {
  holding: "Holding",
  priority: "Priority",
  watchlist: "Watchlist",
};

const HINTS: Record<Category, string> = {
  holding: "Por USD invertido · toca para detalle · mantén para quitar",
  priority: "Corto plazo · flechas para ordenar",
  watchlist: "En la mira · flechas para ordenar",
};

export function Cartera({ state, onReload }: { state: AppState; onReload: () => Promise<void> }) {
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [fairDraft, setFairDraft] = useState("");
  const [usdDraft, setUsdDraft] = useState("");
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  async function addTo(category: Category) {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    setBusy(true);
    try {
      await post("api/tickers", { symbol: s, category });
      setSymbol("");
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function saveRow(p: Position) {
    setBusy(true);
    try {
      const fair = fairDraft.trim() === "" ? (p.fair ?? 0) : Number(fairDraft);
      const invested = usdDraft.trim() === "" ? p.invested : Number(usdDraft);
      await post("api/tickers", {
        symbol: p.symbol,
        category: p.category,
        fairPrice: Number.isFinite(fair) ? fair : p.fair ?? 0,
        investedUsd: Number.isFinite(invested) ? invested : p.invested,
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
    setUsdDraft(p.invested ? String(p.invested) : "");
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
      </header>

      <div className="rounded-2xl border border-ha-border bg-ha-card p-3">
        <label className="text-[11px] text-ha-muted">Ticker</label>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="NVDA"
          autoComplete="off"
          autoCapitalize="characters"
          className="mt-1 w-full rounded-xl bg-[#111318] border border-ha-accent/50 px-3 py-2.5 text-base tracking-wide"
        />
        <p className="text-[11px] text-ha-muted mt-2">Escríbelo y tócalo + en la lista donde va.</p>
      </div>

      {(["holding", "priority", "watchlist"] as Category[]).map((cat) => (
        <section key={cat} className="rounded-2xl border border-ha-border bg-ha-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-ha-border">
            <div className="min-w-0 flex-1">
              <h2 className="font-medium">{LABELS[cat]}</h2>
              <p className="text-[11px] text-ha-muted">{HINTS[cat]}</p>
            </div>
            <button
              type="button"
              disabled={busy || symbol.trim().length < 1}
              onClick={() => void addTo(cat)}
              className="h-9 w-9 rounded-full bg-ha-accent text-black text-xl leading-none disabled:opacity-30"
              aria-label={`Añadir a ${LABELS[cat]}`}
            >
              +
            </button>
          </div>
          {list(cat).length === 0 && <p className="px-3 py-4 text-sm text-ha-muted">Vacío.</p>}
          <ul>
            {list(cat).map((p) => {
              const up = (p.change_pct ?? 0) >= 0;
              const expanded = open === p.symbol;
              return (
                <li key={p.symbol} className="border-t border-ha-border first:border-t-0">
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
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{p.symbol}</span>
                        <span className="text-sm tabular-nums">
                          {p.price_fmt}
                          <span className={`ml-2 ${up ? "text-ha-green" : "text-ha-red"}`}>{p.change_fmt}</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-ha-muted truncate mt-0.5">{p.line2}</p>
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
                    <div className="px-3 pb-3 space-y-2 bg-black/20">
                      <p className="text-[11px] text-ha-muted">{p.line3}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-ha-muted">
                          Fair
                          <input
                            value={fairDraft}
                            onChange={(e) => setFairDraft(e.target.value)}
                            inputMode="decimal"
                            className="mt-1 w-full rounded-lg bg-[#111318] border border-ha-border px-2 py-2 text-sm"
                          />
                        </label>
                        <label className="text-[11px] text-ha-muted">
                          USD invertido
                          <input
                            value={usdDraft}
                            onChange={(e) => setUsdDraft(e.target.value)}
                            inputMode="decimal"
                            className="mt-1 w-full rounded-lg bg-[#111318] border border-ha-border px-2 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveRow(p)}
                          className="rounded-lg bg-ha-accent px-3 py-2 text-sm text-black font-medium"
                        >
                          Guardar
                        </button>
                        <button type="button" onClick={() => setConfirm(p.symbol)} className="rounded-lg bg-white/10 px-3 py-2 text-sm">
                          Quitar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {confirm && (
        <div className="fixed inset-0 z-20 bg-black/60 flex items-end justify-center p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-ha-card border border-ha-border p-4 mb-16" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium">¿Quitar {confirm}?</p>
            <p className="text-sm text-ha-muted mt-1">Sale de las listas. Las cotizaciones del radar de macros no se tocan.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="flex-1 rounded-lg bg-white/10 py-2.5 text-sm">
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
