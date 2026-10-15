export async function discardBody(res: Response) {
  try {
    await res.body?.cancel();
  } catch {
    /* el cuerpo ya estaba cerrado */
  }
}

/** El temporizador gana si la promesa no termina. La petición de fondo puede seguir, pero la cola no. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${Math.round(ms / 1000)}s ${label}`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
