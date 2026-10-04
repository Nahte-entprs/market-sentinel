import { useEffect, useState } from "react";
import { post } from "./api";
import type { AppSettings, AppState, WatchBand } from "./types";

function Num({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="text-[11px] text-ha-muted block">
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
      />
    </label>
  );
}

function Band({
  title,
  band,
  onChange,
}: {
  title: string;
  band: WatchBand;
  onChange: (b: WatchBand) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Movimiento del día %" value={band.changePct} step={0.1} onChange={(n) => onChange({ ...band, changePct: n })} />
        <Num label="Volumen diario ×" value={band.volumeRatio} step={0.1} onChange={(n) => onChange({ ...band, volumeRatio: n })} />
        <Num label="Volumen 5m ×" value={band.intradayVolumeRatio} step={0.1} onChange={(n) => onChange({ ...band, intradayVolumeRatio: n })} />
        <Num label="Tendencia 3 días %" value={band.trendPct} step={0.1} onChange={(n) => onChange({ ...band, trendPct: n })} />
      </div>
    </div>
  );
}

export function Config({ state, onReload }: { state: AppState; onReload: () => Promise<void> }) {
  const [draft, setDraft] = useState<AppSettings>(state.settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(state.settings);
  }, [state.settings, dirty]);

  function edit(next: AppSettings) {
    setDraft(next);
    setDirty(true);
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await post<AppSettings>("api/settings", draft);
      setDirty(false);
      setMsg("Guardado");
      await onReload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const r = draft.reddit;
  const c = draft.cartera;
  const a = draft.alertas;
  const g = draft.regimen;

  return (
    <div className="space-y-3 pb-4">
      <header className="pt-1">
        <p className="text-[11px] uppercase tracking-widest text-ha-muted">Límites</p>
        <h1 className="text-xl font-medium">Configuración</h1>
      </header>

      <details open className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Reddit</summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Num label="Mínimo de menciones en 24 h" value={r.minMentions} onChange={(n) => edit({ ...draft, reddit: { ...r, minMentions: n } })} />
            <Num label="Máximo de tickers" value={r.maxTickers} onChange={(n) => edit({ ...draft, reddit: { ...r, maxTickers: n } })} />
            <Num label="Comentarios por página" value={r.pageSize} onChange={(n) => edit({ ...draft, reddit: { ...r, pageSize: n } })} />
            <Num label="Largo mínimo" value={r.minChars} onChange={(n) => edit({ ...draft, reddit: { ...r, minChars: n } })} />
            <Num label="Largo máximo (0 = sin tope)" value={r.maxChars} onChange={(n) => edit({ ...draft, reddit: { ...r, maxChars: n } })} />
            <Num label="Días de archivo" value={r.keepDays} onChange={(n) => edit({ ...draft, reddit: { ...r, keepDays: n } })} />
            <Num label="Comentarios del daily" value={r.commentsDaily} onChange={(n) => edit({ ...draft, reddit: { ...r, commentsDaily: n } })} />
            <Num label="Posts hot por sub" value={r.hotPostsPerSub} onChange={(n) => edit({ ...draft, reddit: { ...r, hotPostsPerSub: n } })} />
            <Num label="Comentarios por post" value={r.commentsPerPost} onChange={(n) => edit({ ...draft, reddit: { ...r, commentsPerPost: n } })} />
            <Num label="Pico: menciones en 1 h" value={r.spikeLast1h} onChange={(n) => edit({ ...draft, reddit: { ...r, spikeLast1h: n } })} />
            <Num label="Pico: ritmo mínimo" value={r.spikeVelocity} step={0.1} onChange={(n) => edit({ ...draft, reddit: { ...r, spikeVelocity: n } })} />
            <Num label="Ritmo: promedio/hora mínimo" value={r.velocityQuietHour} step={0.1} onChange={(n) => edit({ ...draft, reddit: { ...r, velocityQuietHour: n } })} />
            <Num label="Ritmo: 1 h si el día está quieto" value={r.velocityBurst1h} onChange={(n) => edit({ ...draft, reddit: { ...r, velocityBurst1h: n } })} />
            <Num label="Aviso en silencio desde 1 h" value={r.alertLast1h} onChange={(n) => edit({ ...draft, reddit: { ...r, alertLast1h: n } })} />
          </div>
          <label className="text-[11px] text-ha-muted block">
            Frases ocultas
            <textarea
              value={r.blockText}
              onChange={(e) => edit({ ...draft, reddit: { ...r, blockText: e.target.value } })}
              rows={5}
              placeholder="una por línea"
              className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
            />
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Cartera</summary>
        <div className="mt-3 space-y-4">
          <Band title="Holding" band={c.holding} onChange={(b) => edit({ ...draft, cartera: { ...c, holding: b } })} />
          <Band title="Priority" band={c.priority} onChange={(b) => edit({ ...draft, cartera: { ...c, priority: b } })} />
          <Band title="Watchlist" band={c.watchlist} onChange={(b) => edit({ ...draft, cartera: { ...c, watchlist: b } })} />
          <div>
            <h3 className="text-sm font-medium mb-2">Radar de volumen</h3>
            <div className="grid grid-cols-2 gap-2">
              <Num label="Movimiento %" value={c.radarChangePct} step={0.1} onChange={(n) => edit({ ...draft, cartera: { ...c, radarChangePct: n } })} />
              <Num label="Volumen diario ×" value={c.radarVolumeDaily} step={0.1} onChange={(n) => edit({ ...draft, cartera: { ...c, radarVolumeDaily: n } })} />
              <Num label="Volumen 5m ×" value={c.radarVolume5m} step={0.1} onChange={(n) => edit({ ...draft, cartera: { ...c, radarVolume5m: n } })} />
              <Num label="Movimiento del sector %" value={c.sectorMovePct} step={0.1} onChange={(n) => edit({ ...draft, cartera: { ...c, sectorMovePct: n } })} />
              <Num label="Fuerte en silencio %" value={c.steepQuietPct} step={0.1} onChange={(n) => edit({ ...draft, cartera: { ...c, steepQuietPct: n } })} />
            </div>
          </div>
        </div>
      </details>

      <details className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Alertas</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Num label="Score NORMAL" value={a.scoreNormal} step={0.5} onChange={(n) => edit({ ...draft, alertas: { ...a, scoreNormal: n } })} />
          <Num label="Score WATCH" value={a.scoreWatch} step={0.5} onChange={(n) => edit({ ...draft, alertas: { ...a, scoreWatch: n } })} />
          <Num label="Score HIGH ALERT" value={a.scoreHigh} step={0.5} onChange={(n) => edit({ ...draft, alertas: { ...a, scoreHigh: n } })} />
          <Num label="Score CRISIS" value={a.scoreCrisis} step={0.5} onChange={(n) => edit({ ...draft, alertas: { ...a, scoreCrisis: n } })} />
          <Num label="Espera NORMAL (min)" value={a.cooldownNormalMin} onChange={(n) => edit({ ...draft, alertas: { ...a, cooldownNormalMin: n } })} />
          <Num label="Espera WATCH (min)" value={a.cooldownWatchMin} onChange={(n) => edit({ ...draft, alertas: { ...a, cooldownWatchMin: n } })} />
          <Num label="Espera HIGH (min)" value={a.cooldownHighMin} onChange={(n) => edit({ ...draft, alertas: { ...a, cooldownHighMin: n } })} />
          <Num label="Espera CRISIS (min)" value={a.cooldownCrisisMin} onChange={(n) => edit({ ...draft, alertas: { ...a, cooldownCrisisMin: n } })} />
          <Num label="Aviso CRISIS cada (h)" value={a.crisisPushHours} onChange={(n) => edit({ ...draft, alertas: { ...a, crisisPushHours: n } })} />
          <Num label="Score que ignora el silencio" value={a.crisisBypassScore} step={0.5} onChange={(n) => edit({ ...draft, alertas: { ...a, crisisBypassScore: n } })} />
          <label className="text-[11px] text-ha-muted block">
            Silencio desde
            <input
              type="time"
              value={a.quietStart}
              onChange={(e) => edit({ ...draft, alertas: { ...a, quietStart: e.target.value } })}
              className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
            />
          </label>
          <label className="text-[11px] text-ha-muted block">
            Silencio hasta
            <input
              type="time"
              value={a.quietEnd}
              onChange={(e) => edit({ ...draft, alertas: { ...a, quietEnd: e.target.value } })}
              className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
            />
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Régimen</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Num label="WATCH SPY % ≤" value={g.watchSpy} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, watchSpy: n } })} />
          <Num label="WATCH QQQ % ≤" value={g.watchQqq} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, watchQqq: n } })} />
          <Num label="WATCH SMH % ≤" value={g.watchSmh} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, watchSmh: n } })} />
          <Num label="WATCH VIX ≥" value={g.watchVix} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, watchVix: n } })} />
          <Num label="HIGH SPY % ≤" value={g.highSpy} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, highSpy: n } })} />
          <Num label="HIGH QQQ % ≤" value={g.highQqq} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, highQqq: n } })} />
          <Num label="HIGH SMH % ≤" value={g.highSmh} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, highSmh: n } })} />
          <Num label="HIGH VIX ≥" value={g.highVix} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, highVix: n } })} />
          <Num label="CRISIS SPY % ≤" value={g.crisisSpy} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, crisisSpy: n } })} />
          <Num label="CRISIS QQQ % ≤" value={g.crisisQqq} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, crisisQqq: n } })} />
          <Num label="CRISIS SMH % ≤" value={g.crisisSmh} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, crisisSmh: n } })} />
          <Num label="CRISIS petróleo % ≥" value={g.crisisOil} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, crisisOil: n } })} />
          <Num label="CRISIS cambio VIX % ≥" value={g.crisisVixChange} step={0.1} onChange={(n) => edit({ ...draft, regimen: { ...g, crisisVixChange: n } })} />
        </div>
      </details>

      <button
        type="button"
        disabled={busy || !dirty}
        onClick={() => void save()}
        className="w-full rounded-lg bg-ha-accent py-2.5 text-sm text-ha-onaccent font-medium disabled:opacity-40"
      >
        Guardar
      </button>
      {msg && <p className="text-xs text-ha-muted text-center">{msg}</p>}
    </div>
  );
}
