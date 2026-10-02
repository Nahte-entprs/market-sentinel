import { useEffect, useState } from "react";
import { api } from "./api";
import { Cartera } from "./Cartera";
import { Ideas } from "./Ideas";
import { Radar } from "./Radar";
import { Reddit } from "./Reddit";
import type { AppState, Tab } from "./types";

function parseTab(): Tab {
  const h = (window.location.hash || "#radar").replace("#", "") as Tab;
  if (h === "cartera" || h === "reddit" || h === "ideas" || h === "radar") return h;
  return "radar";
}

const NAV: { id: Tab; label: string }[] = [
  { id: "radar", label: "Radar" },
  { id: "cartera", label: "Cartera" },
  { id: "reddit", label: "Reddit" },
  { id: "ideas", label: "Ideas" },
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
      <main className="flex-1 px-4 pt-4 pb-24">
        {tab === "radar" && <Radar state={state} onReload={load} />}
        {tab === "cartera" && <Cartera state={state} onReload={load} />}
        {tab === "reddit" && <Reddit state={state} onReload={load} />}
        {tab === "ideas" && <Ideas state={state} onReload={load} />}
        <p className="text-[11px] text-ha-muted mt-6 pb-2">{state.disclaimer}</p>
      </main>
      <nav
        className="fixed bottom-0 inset-x-0 border-t border-ha-border bg-[#16181d]/95 backdrop-blur"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto max-w-lg grid grid-cols-4">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.id)}
              className={`py-3 text-xs ${tab === n.id ? "text-ha-accent font-medium" : "text-ha-muted"}`}
            >
              {n.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
