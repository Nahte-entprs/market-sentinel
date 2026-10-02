import { type FormEvent, useState } from "react";
import { post } from "./api";
import { verdictColor, type AppState } from "./types";

export function Ideas({ state, onReload }: { state: AppState; onReload: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [claim, setClaim] = useState("");
  const [factor, setFactor] = useState(state.factors[0]?.id ?? "iran");
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("api/ideas", { title, claim, factorId: factor });
      setTitle("");
      setClaim("");
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <header className="pt-1">
        <p className="text-[11px] uppercase tracking-widest text-ha-muted">Hipótesis</p>
        <h1 className="text-xl font-medium">Ideas</h1>
      </header>
      {state.ideas.map((idea) => (
        <article key={idea.id} className="rounded-2xl border border-ha-border bg-ha-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">{idea.title}</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${verdictColor[idea.verdict]}`}>{idea.verdict}</span>
          </div>
          <p className="text-sm text-ha-muted mt-1">{idea.claim}</p>
          {idea.evidence?.slice(0, 3).map((ev, i) => (
            <p key={i} className="text-xs mt-1">
              {ev.direction === "support" ? "▲" : "▼"} {ev.text}
            </p>
          ))}
        </article>
      ))}
      {state.ideas.length === 0 && <p className="text-sm text-ha-muted">Aún no hay ideas.</p>}
      <form onSubmit={(e) => void add(e)} className="rounded-2xl border border-ha-border bg-ha-card p-4 space-y-2">
        <h2 className="text-sm font-medium">Nueva idea</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título"
          className="w-full rounded-lg bg-[#111318] border border-ha-border px-3 py-2 text-sm"
        />
        <select
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
          className="w-full rounded-lg bg-[#111318] border border-ha-border px-3 py-2 text-sm"
        >
          {state.factors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="Claim corto"
          rows={3}
          className="w-full rounded-lg bg-[#111318] border border-ha-border px-3 py-2 text-sm"
        />
        <button disabled={busy} className="w-full rounded-lg bg-ha-accent py-2.5 text-sm text-black font-medium">
          Guardar
        </button>
      </form>
    </div>
  );
}
