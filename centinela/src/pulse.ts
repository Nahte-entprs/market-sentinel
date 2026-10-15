import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import { DATA_DIR } from "./config.ts";

export type Lane = "fast" | "slow";

type Ctx = { lane: Lane; live: () => boolean };

const store = new AsyncLocalStorage<Ctx>();
const epochs = new Map<string, number>();
const phases: Record<Lane, string> = { fast: "ocioso", slow: "ocioso" };
let currentPhase = "arranque";
let loopLagMs = 0;
let beatHook: (() => void) | null = null;
let started = false;

const BEAT_MS = 10_000;
const FREEZE_MS = 180_000;

export function armJob(id: string): () => boolean {
  const token = (epochs.get(id) ?? 0) + 1;
  epochs.set(id, token);
  return () => epochs.get(id) === token;
}

export function disarmJob(id: string) {
  epochs.set(id, (epochs.get(id) ?? 0) + 1);
}

export function stillRunning() {
  return store.getStore()?.live() ?? true;
}

export function setPhase(next: string) {
  const ctx = store.getStore();
  if (ctx && !ctx.live()) return;
  if (ctx) phases[ctx.lane] = next;
  currentPhase = next;
}

export function phaseOf(lane: Lane) {
  return phases[lane];
}

export function clearPhase(lane: Lane) {
  phases[lane] = "ocioso";
}

export function runInLane<T>(lane: Lane, live: () => boolean, fn: () => Promise<T>): Promise<T> {
  return store.run({ lane, live }, fn);
}

export function loopLag() {
  return loopLagMs;
}

export function onPulse(fn: () => void) {
  beatHook = fn;
}

function freezeStamp() {
  return path.join(DATA_DIR, "freeze.log");
}

function reportPreviousFreeze() {
  const stamp = freezeStamp();
  try {
    if (!fs.existsSync(stamp)) return;
    const text = fs.readFileSync(stamp, "utf8").trim();
    fs.unlinkSync(stamp);
    if (text) console.error(`[watchdog] reinicio tras congelamiento:\n${text}`);
  } catch (err) {
    console.error(`[watchdog] no pude leer freeze.log: ${(err as Error).message}`);
  }
}

function startFreezeWorker() {
  const code = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
let last = Date.now();
let phase = "arranque";
parentPort.on("message", (msg) => { last = Date.now(); phase = String(msg || ""); });
setInterval(() => {
  const lag = Date.now() - last;
  if (lag < ${FREEZE_MS}) return;
  const line = new Date().toISOString() + " sin latido " + Math.round(lag / 1000) + "s · " + phase + "\\n";
  try { fs.appendFileSync(workerData.stamp, line); } catch (e) {}
  console.error("[watchdog] congelado " + Math.round(lag / 1000) + "s, cierro el proceso para reiniciarlo");
  try { process.kill(workerData.pid, "SIGKILL"); } catch (e) {}
}, 5000);
`;
  const worker = new Worker(code, {
    eval: true,
    workerData: { pid: process.pid, stamp: freezeStamp() },
  });
  worker.unref();
  worker.on("error", (err) => console.error(`[watchdog] hilo: ${err.message}`));
  const ping = setInterval(() => {
    worker.postMessage(`fast=${phases.fast} slow=${phases.slow} fase=${currentPhase}`);
  }, 5000);
  ping.unref();
}

export function startPulse() {
  if (started) return;
  started = true;
  reportPreviousFreeze();
  startFreezeWorker();
  let lastBeat = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    loopLagMs = Math.max(0, now - lastBeat - BEAT_MS);
    lastBeat = now;
    if (loopLagMs > 15_000) {
      console.error(`[watchdog] event loop atrasado ${Math.round(loopLagMs / 1000)}s · fase ${currentPhase}`);
    }
    try {
      beatHook?.();
    } catch (err) {
      console.error(`[watchdog] ${(err as Error).message}`);
    }
  }, BEAT_MS);
  timer.unref();
  process.on("unhandledRejection", (err) => {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[centinela] promesa sin capturar · fase ${currentPhase}\n${msg}`);
  });
  process.on("uncaughtException", (err) => {
    console.error(`[centinela] excepción · fase ${currentPhase}\n${err.stack || err.message}`);
    process.exit(1);
  });
  console.log("[watchdog] latido cada 10s · si el proceso no responde en 3 min, se reinicia");
}
