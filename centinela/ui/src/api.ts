function url(path: string) {
  const rel = path.replace(/^\//, "");
  return new URL(rel, document.baseURI);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function post<T>(path: string, body: unknown) {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function del(path: string) {
  return api<{ ok: boolean }>(path, { method: "DELETE" });
}
