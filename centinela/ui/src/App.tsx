import { useEffect, useState } from "react";
import { api } from "./api";
import { Cartera } from "./Cartera";
import { Config } from "./Config";
import { Ideas } from "./Ideas";
import { Radar } from "./Radar";
import { Reddit } from "./Reddit";
import type { AppState, Tab } from "./types";

function parseTab(): Tab {
  const h = (window.location.hash || "").replace("#", "");
  if (h === "cartera" || h === "reddit" || h === "ideas" || h === "radar" || h === "config") return h;
  const q = new URLSearchParams(window.location.search).get("tab");
  if (q === "cartera" || q === "reddit" || q === "ideas" || q === "radar" || q === "config") return q;
  return "radar";
}

function IconRadar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12 19 8" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconBriefcase({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M8 8V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" />
      <path d="M3 13h18" />
    </svg>
  );
}

function IconReddit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M14.2 3.2a1.1 1.1 0 0 0-1 .7l-.4 1.3a6.7 6.7 0 0 0-3.7.9 2.4 2.4 0 1 0-2.3 3.6 4.8 4.8 0 0 0-.5 2.1c0 3.2 3.1 5.8 7 5.8s7-2.6 7-5.8a4.8 4.8 0 0 0-.5-2.1 2.4 2.4 0 1 0-2.3-3.6 6.7 6.7 0 0 0-3.7-.9l.4-1.2a.3.3 0 0 1 .3-.2h1.6a1.4 1.4 0 1 0 0-2.8h-.2c-.8 0-1.4.4-1.7 1zm-5 8.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm5.6 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM8.8 15.6c.9.8 2.2 1.3 3.7 1.3s2.8-.5 3.7-1.3a.7.7 0 0 1 1 .9C16 17.7 14.3 18.4 12.5 18.4s-3.5-.7-4.7-1.9a.7.7 0 1 1 1-.9z" />
    </svg>
  );
}

function IconGear({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </svg>
  );
}

function IconBulb({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.8c.6.5 1 1.2 1.1 2h4.8c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z" />
    </svg>
  );
}

const NAV: { id: Tab; label: string; Icon: typeof IconRadar }[] = [
  { id: "radar", label: "Radar", Icon: IconRadar },
  { id: "cartera", label: "Cartera", Icon: IconBriefcase },
  { id: "reddit", label: "Reddit", Icon: IconReddit },
  { id: "ideas", label: "Ideas", Icon: IconBulb },
  { id: "config", label: "Config", Icon: IconGear },
];

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(parseTab);

  async function load() {
    try {
      setState(await api<AppState>("api/state"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onHash = () => setTab(parseTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function go(id: Tab) {
    window.location.hash = id;
    setTab(id);
  }

  if (!state && error) {
    return <div className="p-6 text-ha-red text-sm">No hay conexión con el motor: {error}</div>;
  }
  if (!state) return <div className="p-6 text-ha-muted text-sm">Cargando…</div>;

  return (
    <div className="mx-auto max-w-lg min-h-dvh flex flex-col">
      <nav
        className="sticky top-0 z-10 border-b border-ha-border bg-ha-nav/95 backdrop-blur"
        style={{ paddingTop: "max(0.25rem, env(safe-area-inset-top))" }}
      >
        <div className="mx-auto max-w-lg grid grid-cols-5">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.id)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${tab === n.id ? "text-ha-accent font-medium" : "text-ha-muted"}`}
            >
              <n.Icon className="h-5 w-5" />
              {n.label}
            </button>
          ))}
        </div>
      </nav>
      <main className="flex-1 px-4 pt-4 pb-8">
        {tab === "radar" && <Radar state={state} onReload={load} />}
        {tab === "cartera" && <Cartera state={state} onReload={load} />}
        {tab === "reddit" && <Reddit state={state} onReload={load} />}
        {tab === "ideas" && <Ideas state={state} onReload={load} />}
        {tab === "config" && <Config state={state} onReload={load} />}
        <p className="text-[11px] text-ha-muted mt-6 pb-2">{state.disclaimer}</p>
      </main>
    </div>
  );
}
