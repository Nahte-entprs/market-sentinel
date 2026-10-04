import { useEffect, useState, type ReactNode } from "react";
import { post } from "./api";
import { Lab } from "./Lab";
import type { AppSettings, AppState, WatchBand } from "./types";

function Field({
  title,
  hint,
  value,
  onChange,
  step = 1,
}: {
  title: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-ha-text">{title}</span>
      <span className="block text-xs text-ha-muted leading-snug">{hint}</span>
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

function TimeField({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-ha-text">{title}</span>
      <span className="block text-xs text-ha-muted leading-snug">{hint}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
      />
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 pt-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  );
}

function BandFields({
  title,
  intro,
  band,
  onChange,
}: {
  title: string;
  intro: string;
  band: WatchBand;
  onChange: (b: WatchBand) => void;
}) {
  return (
    <Group title={title}>
      <p className="text-xs text-ha-muted leading-snug">{intro}</p>
      <Field
        title="Movimiento del día"
        hint="Aviso si el precio del día se mueve al menos este porcentaje, hacia arriba o hacia abajo."
        value={band.changePct}
        step={0.1}
        onChange={(n) => onChange({ ...band, changePct: n })}
      />
      <Field
        title="Ritmo de la sesión"
        hint="Volumen acumulado de hoy frente a lo normal a esta misma hora. 1,5 es un 50% más que un día típico a esa hora. Avisa al cruzarlo y otra vez si el ritmo sube 0,5 más. La apertura y el cierre no cuentan solos por ser apertura o cierre."
        value={band.sessionPaceRatio}
        step={0.1}
        onChange={(n) => onChange({ ...band, sessionPaceRatio: n })}
      />
      <Field
        title="Volumen del día completo"
        hint="Veces un día entero normal. Durante la sesión solo entra si hoy ya superó ese múltiplo antes del cierre."
        value={band.volumeRatio}
        step={0.1}
        onChange={(n) => onChange({ ...band, volumeRatio: n })}
      />
      <Field
        title="Vela de 5 minutos"
        hint="La última vela comparada con la vela de la misma hora en días recientes. 3,5 es tres veces y media esa hora, no el mediodía."
        value={band.intradayVolumeRatio}
        step={0.1}
        onChange={(n) => onChange({ ...band, intradayVolumeRatio: n })}
      />
      <Field
        title="Tendencia de 3 días"
        hint="Suma del movimiento de los últimos 3 cierres. Avisa si esa suma pasa de este porcentaje."
        value={band.trendPct}
        step={0.1}
        onChange={(n) => onChange({ ...band, trendPct: n })}
      />
    </Group>
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
  const setR = (patch: Partial<AppSettings["reddit"]>) => edit({ ...draft, reddit: { ...r, ...patch } });
  const setC = (patch: Partial<AppSettings["cartera"]>) => edit({ ...draft, cartera: { ...c, ...patch } });
  const setA = (patch: Partial<AppSettings["alertas"]>) => edit({ ...draft, alertas: { ...a, ...patch } });
  const setG = (patch: Partial<AppSettings["regimen"]>) => edit({ ...draft, regimen: { ...g, ...patch } });

  return (
    <div className="space-y-3 pb-4">
      <header className="pt-1">
        <p className="text-[11px] uppercase tracking-widest text-ha-muted">Límites</p>
        <h1 className="text-xl font-medium">Configuración</h1>
      </header>

      <details open className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Reddit</summary>
        <div className="mt-3 space-y-4">
          <Field
            title="Mínimo de menciones en 24 h"
            hint="Un ticker con menos comentarios que este número en las últimas 24 horas no entra en la tabla. Sube el número si la lista sigue llena de nombres que apenas se nombran."
            value={r.minMentions}
            onChange={(n) => setR({ minMentions: n })}
          />
          <Field
            title="Máximo de tickers"
            hint="Tope de filas en la tabla, después de ocultar los que no llegan al mínimo. Los que están subiendo quedan primero."
            value={r.maxTickers}
            onChange={(n) => setR({ maxTickers: n })}
          />
          <Field
            title="Comentarios por página"
            hint="Cuántos comentarios se abren al tocar un ticker, antes del botón Siguientes."
            value={r.pageSize}
            onChange={(n) => setR({ pageSize: n })}
          />
          <Field
            title="Largo mínimo del comentario"
            hint="Caracteres mínimos para mostrar un comentario. Los muy cortos (solo un ticker, un emoji) quedan fuera."
            value={r.minChars}
            onChange={(n) => setR({ minChars: n })}
          />
          <Field
            title="Largo máximo del comentario"
            hint="Si un comentario pasa de esta cantidad de caracteres, no se muestra. 0 quiere decir sin tope. Úsalo para cortar textos enormes de troll."
            value={r.maxChars}
            onChange={(n) => setR({ maxChars: n })}
          />
          <Field
            title="Flecha verde: cuánto más rápido"
            hint="Compara las menciones de la última hora con el ritmo de las 2 horas anteriores. 1,4 significa que la última hora va al menos un 40% más rápido que esas 2 horas. Si se cumple, la flecha es verde hacia arriba (está surgiendo)."
            value={r.surgeUpRatio}
            step={0.1}
            onChange={(n) => setR({ surgeUpRatio: n })}
          />
          <Field
            title="Flecha roja: cuánto más lento"
            hint="0,7 significa que la última hora va a un 70% o menos del ritmo de las 2 horas anteriores. Si además la caída es clara, la flecha es roja hacia abajo (está perdiendo impulso). Entre ambos casos queda el guion gris: se mantiene."
            value={r.surgeDownRatio}
            step={0.05}
            onChange={(n) => setR({ surgeDownRatio: n })}
          />
          <Field
            title="Diferencia mínima para cambiar la flecha"
            hint="Menciones por hora de diferencia que hacen falta para no marcar un ticker por un solo comentario de más o de menos. 1 es sensible. 2 o 3 pide un cambio más claro."
            value={r.surgeMinGap}
            step={0.5}
            onChange={(n) => setR({ surgeMinGap: n })}
          />
          <Field
            title="Días que se conserva el archivo"
            hint="Los comentarios más viejos que esto se borran en la próxima recolección, para no llenar el disco. No cambia la ventana de 24 horas que ves en la pantalla."
            value={r.keepDays}
            onChange={(n) => setR({ keepDays: n })}
          />
          <Field
            title="Comentarios que se bajan del daily de WSB"
            hint="Cuántos comentarios nuevos se leen del hilo Daily o Weekend de r/wallstreetbets en cada pasada."
            value={r.commentsDaily}
            onChange={(n) => setR({ commentsDaily: n })}
          />
          <Field
            title="Posts hot por subreddit"
            hint="En los otros subs, cuántos hilos calientes se abren en cada pasada (además de WSB)."
            value={r.hotPostsPerSub}
            onChange={(n) => setR({ hotPostsPerSub: n })}
          />
          <Field
            title="Comentarios por post"
            hint="Cuántos comentarios se leen de cada uno de esos hilos."
            value={r.commentsPerPost}
            onChange={(n) => setR({ commentsPerPost: n })}
          />
          <Field
            title="Aviso: menciones en la última hora"
            hint="Para el aviso al teléfono, no para la flecha de la tabla. El ticker tiene que tener al menos esta cantidad de menciones en la última hora."
            value={r.spikeLast1h}
            onChange={(n) => setR({ spikeLast1h: n })}
          />
          <Field
            title="Aviso: veces el ritmo del resto del día"
            hint="La última hora se divide por el promedio por hora de las otras 23. 2,5 significa que se está nombrando al menos dos veces y media más rápido que durante el resto del día. Las dos condiciones (esta y la anterior) tienen que cumplirse para avisar."
            value={r.spikeVelocity}
            step={0.1}
            onChange={(n) => setR({ spikeVelocity: n })}
          />
          <Field
            title="Cuándo el resto del día cuenta como ritmo"
            hint="Si el promedio del resto del día está por debajo de este número de menciones por hora, no se usa esa división (un ticker casi mudo daría un ritmo enorme). En ese caso se mira la siguiente casilla."
            value={r.velocityQuietHour}
            step={0.1}
            onChange={(n) => setR({ velocityQuietHour: n })}
          />
          <Field
            title="Menciones en 1 h si el día venía quieto"
            hint="Cuando el resto del día casi no habló del ticker, esta cantidad en la última hora basta para tratarlo como un pico fuerte en el aviso."
            value={r.velocityBurst1h}
            onChange={(n) => setR({ velocityBurst1h: n })}
          />
          <Field
            title="Aviso durante el horario de silencio"
            hint="De noche no se avisa un pico de Reddit, salvo que algún ticker llegue a esta cantidad de menciones en la última hora."
            value={r.alertLast1h}
            onChange={(n) => setR({ alertLast1h: n })}
          />
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ha-text">Frases que ocultan un comentario</span>
            <span className="block text-xs text-ha-muted leading-snug">
              Una frase por línea. Si el comentario la contiene, no se muestra. Sirve para copypastas, bait y textos de troll que ya reconoces. No distingue mayúsculas.
            </span>
            <textarea
              value={r.blockText}
              onChange={(e) => setR({ blockText: e.target.value })}
              rows={5}
              placeholder="una por línea"
              className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
            />
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Cartera</summary>
        <div className="mt-3 space-y-5">
          <BandFields
            title="Holding"
            intro="Umbrales del aviso al teléfono para lo que tienes en holding. Cualquiera de estas condiciones puede dispararlo."
            band={c.holding}
            onChange={(b) => setC({ holding: b })}
          />
          <BandFields
            title="Priority"
            intro="Igual que holding, para la lista de corto plazo."
            band={c.priority}
            onChange={(b) => setC({ priority: b })}
          />
          <BandFields
            title="Watchlist"
            intro="Igual que holding, para los tickers que solo estás mirando. Suele ir más alto para no avisar por cada movimiento."
            band={c.watchlist}
            onChange={(b) => setC({ watchlist: b })}
          />
          <Group title="Radar de volumen">
            <p className="text-xs text-ha-muted leading-snug">
              Estos cortes arman la alerta del radar (la de la pestaña Radar), distinta del aviso corto de la cartera.
            </p>
            <Field
              title="Movimiento del precio"
              hint="Porcentaje del día a partir del cual el precio entra como motivo de la alerta."
              value={c.radarChangePct}
              step={0.1}
              onChange={(n) => setC({ radarChangePct: n })}
            />
            <Field
              title="Volumen diario"
              hint="Veces un día completo normal. Por encima de esto, el volumen del día entra como motivo."
              value={c.radarVolumeDaily}
              step={0.1}
              onChange={(n) => setC({ radarVolumeDaily: n })}
            />
            <Field
              title="Ritmo de la sesión"
              hint="Acumulado de hoy contra lo normal a esta hora. Por encima de esto entra como motivo."
              value={c.radarSessionPace}
              step={0.1}
              onChange={(n) => setC({ radarSessionPace: n })}
            />
            <Field
              title="Vela de 5 minutos"
              hint="Veces la vela de la misma hora en días recientes. Por encima de esto, esa vela entra como motivo."
              value={c.radarVolume5m}
              step={0.1}
              onChange={(n) => setC({ radarVolume5m: n })}
            />
            <Field
              title="Movimiento del sector"
              hint="Si el ETF del sector se mueve al menos este porcentaje, se suma como contexto de la alerta."
              value={c.sectorMovePct}
              step={0.1}
              onChange={(n) => setC({ sectorMovePct: n })}
            />
            <Field
              title="Movimiento que ignora el silencio"
              hint="De noche la cartera no avisa, salvo holding y salvo un movimiento del día de al menos este porcentaje."
              value={c.steepQuietPct}
              step={0.1}
              onChange={(n) => setC({ steepQuietPct: n })}
            />
          </Group>
        </div>
      </details>

      <details className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Alertas</summary>
        <div className="mt-3 space-y-4">
          <Field
            title="Puntaje mínimo en NORMAL"
            hint="Suma de motivos que hace falta para publicar una alerta cuando el régimen está en NORMAL. Más alto = menos alertas."
            value={a.scoreNormal}
            step={0.5}
            onChange={(n) => setA({ scoreNormal: n })}
          />
          <Field
            title="Puntaje mínimo en WATCH"
            hint="Lo mismo cuando el régimen es WATCH. Suele ser más bajo que NORMAL, porque el mercado ya está inquieto."
            value={a.scoreWatch}
            step={0.5}
            onChange={(n) => setA({ scoreWatch: n })}
          />
          <Field
            title="Puntaje mínimo en HIGH ALERT"
            hint="Lo mismo en HIGH ALERT."
            value={a.scoreHigh}
            step={0.5}
            onChange={(n) => setA({ scoreHigh: n })}
          />
          <Field
            title="Puntaje mínimo en CRISIS"
            hint="Lo mismo en CRISIS. Es el más permisivo: con el mercado ya roto, un motivo más chico alcanza."
            value={a.scoreCrisis}
            step={0.5}
            onChange={(n) => setA({ scoreCrisis: n })}
          />
          <Field
            title="Espera entre avisos en NORMAL"
            hint="Minutos que tienen que pasar antes de volver a avisar lo mismo. Evita repetir el mismo ticker cada pocos minutos."
            value={a.cooldownNormalMin}
            onChange={(n) => setA({ cooldownNormalMin: n })}
          />
          <Field
            title="Espera en WATCH"
            hint="Minutos de espera cuando el régimen es WATCH."
            value={a.cooldownWatchMin}
            onChange={(n) => setA({ cooldownWatchMin: n })}
          />
          <Field
            title="Espera en HIGH ALERT"
            hint="Minutos de espera en HIGH ALERT."
            value={a.cooldownHighMin}
            onChange={(n) => setA({ cooldownHighMin: n })}
          />
          <Field
            title="Espera en CRISIS"
            hint="Minutos de espera en CRISIS. Más corto, para no perderte un segundo golpe."
            value={a.cooldownCrisisMin}
            onChange={(n) => setA({ cooldownCrisisMin: n })}
          />
          <Field
            title="Aviso de régimen CRISIS"
            hint="Horas mínimas entre un aviso de “entramos en CRISIS” y el siguiente."
            value={a.crisisPushHours}
            onChange={(n) => setA({ crisisPushHours: n })}
          />
          <Field
            title="Puntaje que suena de noche"
            hint="En horario de silencio no se empuja la alerta al teléfono, salvo que el régimen sea CRISIS y el puntaje llegue a este número."
            value={a.crisisBypassScore}
            step={0.5}
            onChange={(n) => setA({ crisisBypassScore: n })}
          />
          <TimeField
            title="Silencio desde"
            hint="Hora local en la que empiezan a callarse los avisos al teléfono. El radar sigue calculando."
            value={a.quietStart}
            onChange={(v) => setA({ quietStart: v })}
          />
          <TimeField
            title="Silencio hasta"
            hint="Hora local en la que vuelven los avisos. Si “desde” es más tarde que “hasta”, el silencio cruza la medianoche."
            value={a.quietEnd}
            onChange={(v) => setA({ quietEnd: v })}
          />
        </div>
      </details>

      <details className="rounded-2xl border border-ha-border bg-ha-card p-4">
        <summary className="cursor-pointer font-medium">Régimen</summary>
        <div className="mt-3 space-y-4">
          <p className="text-xs text-ha-muted leading-snug">
            El régimen mira el día de SPY, QQQ, SMH, el nivel del VIX y, para crisis, también el petróleo y el salto del VIX. Basta con que se cumpla una condición del nivel para subir de NORMAL a WATCH o a HIGH ALERT. CRISIS pide las tres bolsas juntas, o SMH junto con petróleo o con el salto del VIX.
          </p>
          <Field title="WATCH si SPY cae a este % o más" hint="Porcentaje del día. -1 significa una caída de 1% o peor." value={g.watchSpy} step={0.1} onChange={(n) => setG({ watchSpy: n })} />
          <Field title="WATCH si QQQ cae a este % o más" hint="Igual que SPY, para el Nasdaq 100." value={g.watchQqq} step={0.1} onChange={(n) => setG({ watchQqq: n })} />
          <Field title="WATCH si SMH cae a este % o más" hint="Igual, para el ETF de semiconductores." value={g.watchSmh} step={0.1} onChange={(n) => setG({ watchSmh: n })} />
          <Field title="WATCH si el VIX llega a este nivel" hint="No es un porcentaje: es el valor del índice VIX. 22 ya es un mercado nervioso." value={g.watchVix} step={0.1} onChange={(n) => setG({ watchVix: n })} />
          <Field title="HIGH ALERT si SPY cae a este % o más" hint="Caída del día de SPY que sube el régimen a HIGH ALERT." value={g.highSpy} step={0.1} onChange={(n) => setG({ highSpy: n })} />
          <Field title="HIGH ALERT si QQQ cae a este % o más" hint="Caída del día de QQQ para HIGH ALERT." value={g.highQqq} step={0.1} onChange={(n) => setG({ highQqq: n })} />
          <Field title="HIGH ALERT si SMH cae a este % o más" hint="Caída del día de SMH para HIGH ALERT." value={g.highSmh} step={0.1} onChange={(n) => setG({ highSmh: n })} />
          <Field title="HIGH ALERT si el VIX llega a este nivel" hint="Nivel del VIX que por sí solo pone HIGH ALERT." value={g.highVix} step={0.1} onChange={(n) => setG({ highVix: n })} />
          <Field title="CRISIS si SPY cae a este % o más" hint="Tiene que cumplirse junto con QQQ y SMH, no solo." value={g.crisisSpy} step={0.1} onChange={(n) => setG({ crisisSpy: n })} />
          <Field title="CRISIS si QQQ cae a este % o más" hint="Segunda pata de las tres bolsas." value={g.crisisQqq} step={0.1} onChange={(n) => setG({ crisisQqq: n })} />
          <Field title="CRISIS si SMH cae a este % o más" hint="Tercera pata. También sirve solo si el petróleo o el VIX acompañan." value={g.crisisSmh} step={0.1} onChange={(n) => setG({ crisisSmh: n })} />
          <Field title="CRISIS si el petróleo sube este %" hint="Junto con la caída de SMH, una subida del crudo de al menos este porcentaje del día declara CRISIS." value={g.crisisOil} step={0.1} onChange={(n) => setG({ crisisOil: n })} />
          <Field title="CRISIS si el VIX salta este %" hint="Cambio del día del VIX, no su nivel. Junto con la caída de SMH, declara CRISIS." value={g.crisisVixChange} step={0.1} onChange={(n) => setG({ crisisVixChange: n })} />
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
      <Lab />
    </div>
  );
}
