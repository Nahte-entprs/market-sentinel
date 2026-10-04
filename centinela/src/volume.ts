/** Volumen por hora del día, no contra el mediodía.

La apertura y el cierre siempre negocian más. Esas velas se comparan con la misma
vela de sesiones anteriores. El ritmo compara el acumulado de hoy con lo acumulado
a esta misma hora. Así un día entero más activo (como las semanas previas a
resultados) se ve, y la apertura normal no.
*/

export type IntradayBar = { ts: string; volume: number };

export type VolumeSignal = {
  sessionDate: string | null;
  sessionDone: boolean;
  /** Índice de la última vela cerrada (0 = 9:30 ET). Null si aún no hay vela cerrada. */
  barSlot: number | null;
  /** Última vela de 5 min ya cerrada, contra la mediana de esa misma hora. */
  burstRatio: number | null;
  burstSamples: number;
  /** Acumulado de la sesión hasta esa vela, contra la mediana de los últimos 14 días abiertos. */
  paceRatio: number | null;
  paceSamples: number;
};

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const BAR_MS = 5 * 60_000;
export const MIN_SLOT_SAMPLES = 5;
/** Sesiones de mercado abierto contra las que se compara hoy. */
export const LOOKBACK_SESSIONS = 14;

const nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function nyParts(ms: number): { date: string; minutes: number } {
  const parts = nyFmt.formatToParts(new Date(ms));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(pick("minute"));
  return { date: `${pick("year")}-${pick("month")}-${pick("day")}`, minutes: hour * 60 + minute };
}

export function nyDay(ms: number) {
  return nyParts(ms).date;
}

function rthSlot(minutes: number): number | null {
  if (minutes < OPEN_MIN || minutes >= CLOSE_MIN) return null;
  return Math.floor((minutes - OPEN_MIN) / 5);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function volumeSignal(bars: IntradayBar[], now = Date.now()): VolumeSignal {
  const empty: VolumeSignal = {
    sessionDate: null,
    sessionDone: false,
    barSlot: null,
    burstRatio: null,
    burstSamples: 0,
    paceRatio: null,
    paceSamples: 0,
  };
  const byDate = new Map<string, Map<number, number>>();
  const barStart = new Map<string, number>();
  for (const bar of bars) {
    const ms = Date.parse(bar.ts);
    if (!Number.isFinite(ms) || !(bar.volume > 0)) continue;
    const ny = nyParts(ms);
    const slot = rthSlot(ny.minutes);
    if (slot == null) continue;
    let slots = byDate.get(ny.date);
    if (!slots) {
      slots = new Map();
      byDate.set(ny.date, slots);
    }
    slots.set(slot, (slots.get(slot) ?? 0) + bar.volume);
    const key = `${ny.date}:${slot}`;
    const prev = barStart.get(key);
    if (prev == null || ms > prev) barStart.set(key, ms);
  }
  const dates = [...byDate.keys()].sort();
  const sessionDate = dates.at(-1) ?? null;
  if (!sessionDate) return empty;
  const today = nyParts(now);
  const sessionDone = sessionDate < today.date || today.minutes >= CLOSE_MIN;
  const slots = byDate.get(sessionDate)!;
  const closed = [...slots.keys()]
    .filter((slot) => {
      const start = barStart.get(`${sessionDate}:${slot}`) ?? 0;
      return start > 0 && now >= start + BAR_MS;
    })
    .sort((a, b) => a - b);
  const slot = closed.at(-1);
  if (slot == null) {
    return { ...empty, sessionDate, sessionDone };
  }

  const prior = dates.filter((d) => d !== sessionDate).slice(-LOOKBACK_SESSIONS);
  const burstBase: number[] = [];
  const paceBase: number[] = [];
  const needSlots = Math.max(1, Math.ceil((slot + 1) * 0.6));
  for (const date of prior) {
    const day = byDate.get(date)!;
    const same = day.get(slot);
    if (same != null) burstBase.push(same);
    const covered = [...day.keys()].filter((s) => s <= slot).length;
    const reached = [...day.keys()].some((s) => s >= slot - 1);
    if (covered >= needSlots && reached) {
      let cum = 0;
      for (const [s, vol] of day) if (s <= slot) cum += vol;
      if (cum > 0) paceBase.push(cum);
    }
  }

  let todayCum = 0;
  for (const [s, vol] of slots) if (s <= slot && closed.includes(s)) todayCum += vol;
  const burstMed = median(burstBase);
  const paceMed = median(paceBase);
  return {
    sessionDate,
    sessionDone,
    barSlot: slot,
    burstSamples: burstBase.length,
    burstRatio: burstMed != null && burstMed >= 50 && burstBase.length >= MIN_SLOT_SAMPLES ? slots.get(slot)! / burstMed : null,
    paceSamples: paceBase.length,
    paceRatio: paceMed != null && paceMed >= 200 && paceBase.length >= MIN_SLOT_SAMPLES ? todayCum / paceMed : null,
  };
}
