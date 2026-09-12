import graphFile from "../data/event-graph.json" with { type: "json" };

export type GraphNode = {
  id: string;
  kind: "ticker" | "sector" | "factor" | "theme";
  label: string;
  sector?: string;
  etf?: string;
};

export type GraphEdge = { from: string; to: string; weight: number; rel: string };

const nodes = graphFile.nodes as GraphNode[];
const edges = graphFile.edges as GraphEdge[];

const byId = new Map(nodes.map((n) => [n.id, n]));
const out = new Map<string, GraphEdge[]>();
for (const e of edges) {
  const list = out.get(e.from) ?? [];
  list.push(e);
  out.set(e.from, list);
}

export function getNode(id: string) {
  return byId.get(id);
}

export function neighbors(id: string, hops = 2): { id: string; hop: number; weight: number; path: string[] }[] {
  const seen = new Set<string>([id]);
  const acc: { id: string; hop: number; weight: number; path: string[] }[] = [];
  let frontier: { id: string; weight: number; path: string[] }[] = [{ id, weight: 3, path: [id] }];
  for (let hop = 1; hop <= hops; hop++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (const e of out.get(f.id) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        const item = {
          id: e.to,
          hop,
          weight: Math.min(f.weight, e.weight),
          path: [...f.path, e.to],
        };
        acc.push(item);
        next.push({ id: e.to, weight: item.weight, path: item.path });
      }
    }
    frontier = next;
  }
  return acc;
}

export function tickersFromEntities(entities: string[]): { symbol: string; via: string[]; weight: number }[] {
  const found = new Map<string, { via: string[]; weight: number }>();
  for (const ent of entities) {
    const node = byId.get(ent);
    if (!node) continue;
    if (node.kind === "ticker") {
      const prev = found.get(node.id);
      if (!prev || 3 > prev.weight) found.set(node.id, { via: [ent], weight: 3 });
    }
    for (const n of neighbors(ent, 2)) {
      const dest = byId.get(n.id);
      if (dest?.kind !== "ticker") continue;
      const prev = found.get(dest.id);
      if (!prev || n.weight > prev.weight) found.set(dest.id, { via: n.path, weight: n.weight });
    }
  }
  return [...found.entries()].map(([symbol, v]) => ({ symbol, ...v }));
}

export function allFactorIds() {
  return nodes.filter((n) => n.kind === "factor").map((n) => n.id);
}

export { nodes as graphNodes, edges as graphEdges };
