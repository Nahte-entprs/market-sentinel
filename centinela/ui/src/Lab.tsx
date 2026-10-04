import { useState } from "react";
import { post } from "./api";

const SECTIONS = [
  { id: "reddit", label: "Reddit" },
  { id: "cartera", label: "Cartera" },
  { id: "radar", label: "Radar" },
  { id: "ideas", label: "Ideas" },
] as const;

const LAB_KEY = "centinela-lab";

export function Lab() {
  const [open, setOpen] = useState(() => localStorage.getItem(LAB_KEY) === "1");
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("reddit");
  const [title, setTitle] = useState("Advertencia: Menciones de RKLB en alza");
  const [message, setMessage] = useState("6 en la última hora, 8 en 3 h, 12 en 24 h.");
  const [ticker, setTicker] = useState("RKLB");
  const [last1h, setLast1h] = useState("6");
  const [last3h, setLast3h] = useState("8");
  const [day, setDay] = useState("12");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    localStorage.setItem(LAB_KEY, next ? "1" : "0");
  }

  function fillRise() {
    const sym = ticker.trim().toUpperCase() || "RKLB";
    setTicker(sym);
    setSection("reddit");
    setTitle(`Advertencia: Menciones de ${sym} en alza`);
    setMessage(`${last1h || "0"} en la última hora, ${last3h || "0"} en 3 h, ${day || "0"} en 24 h.`);
    setNote(null);
  }

  async function send() {
    setBusy(true);
    setNote(null);
    try {
      await post("api/test/notify", { section, title: title.trim(), message: message.trim() });
      setNote("Enviado. Si el paquete de Home Assistant está activo, llega al teléfono.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggle}
        className="w-full rounded-lg bg-ha-inset py-2.5 text-sm font-medium"
      >
        {open ? "Ocultar sección de pruebas" : "Habilitar sección de pruebas"}
      </button>
      {open && (
        <section className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-4">
          <div>
            <h2 className="font-medium">Pruebas</h2>
            <p className="text-xs text-ha-muted leading-snug mt-1">
              Dispara un aviso real, sin esperar una pasada de Reddit ni el horario. No usa los umbrales ni la espera entre avisos.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Aviso de menciones en alza</h3>
            <p className="text-xs text-ha-muted leading-snug">
              Rellena el título y el mensaje con un ticker y unos conteos a mano. Después puedes editarlos y enviarlos.
            </p>
            <label className="block text-[11px] text-ha-muted">
              Ticker
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-[11px] text-ha-muted">
                1 h
                <input
                  inputMode="numeric"
                  value={last1h}
                  onChange={(e) => setLast1h(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
                />
              </label>
              <label className="block text-[11px] text-ha-muted">
                3 h
                <input
                  inputMode="numeric"
                  value={last3h}
                  onChange={(e) => setLast3h(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
                />
              </label>
              <label className="block text-[11px] text-ha-muted">
                24 h
                <input
                  inputMode="numeric"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
                />
              </label>
            </div>
            <button type="button" onClick={fillRise} className="rounded-lg bg-ha-inset px-3 py-2 text-sm">
              Rellenar aviso
            </button>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Aviso manual</h3>
            <label className="block text-[11px] text-ha-muted">
              Sección
              <select
                value={section}
                onChange={(e) => setSection(e.target.value as (typeof SECTIONS)[number]["id"])}
                className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
              >
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-ha-muted">
              Título
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
              />
            </label>
            <label className="block text-[11px] text-ha-muted">
              Mensaje
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg bg-ha-input border border-ha-border px-2 py-2 text-sm text-ha-text"
              />
            </label>
            <button
              type="button"
              disabled={busy || !title.trim() || !message.trim()}
              onClick={() => void send()}
              className="w-full rounded-lg bg-ha-accent py-2.5 text-sm text-ha-onaccent font-medium disabled:opacity-40"
            >
              Enviar aviso
            </button>
            {note && <p className="text-xs text-ha-muted">{note}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
