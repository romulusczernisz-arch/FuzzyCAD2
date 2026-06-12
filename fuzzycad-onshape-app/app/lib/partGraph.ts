import type { MeshGraphNode } from "../components/FuzzyCADGeometryViewer";

export type LogicalOccurrence = {
  occurrenceId: string;
  pathKey: string;
  path: string[];
  transform: number[] | null;
  translation: { x: number; y: number; z: number } | null;
};
export type MatchedInstance = {
  instanceId: string;
  name: string | null;
  type: string | null;
  sourceKey: string;
} | null;
export type LogicalMateEdge = {
  a: string;
  b: string;
  mateType: string | null;
  featureId: string | null;
};
export type PartNode = {
  occurrenceId: string;
  pathKey: string;
  path: string[];
  worldTransform: number[] | null;
  translation: { x: number; y: number; z: number } | null;
  instance: MatchedInstance;
  meshNodeIds: string[];
  matchResidual: number | null;
  mateEdges: { to: string; mateType: string | null; featureId: string | null }[];
};

type Vec3 = [number, number, number];
function onshapeT(t: number[]): Vec3 {
  return [t[3], t[7], t[11]];
}
function threeT(m: number[]): Vec3 {
  return [m[12], m[13], m[14]];
}
function dist3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0],
    dy = a[1] - b[1],
    dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function detectScale(occT: Vec3[], nodeT: Vec3[]): number {
  const candidates = [1, 0.001, 1000];
  let best = 1;
  let bestSum = Infinity;
  for (const s of candidates) {
    let sum = 0;
    for (const o of occT) {
      const so: Vec3 = [o[0] * s, o[1] * s, o[2] * s];
      let m = Infinity;
      for (const n of nodeT) m = Math.min(m, dist3(so, n));
      sum += m;
    }
    if (sum < bestSum) {
      bestSum = sum;
      best = s;
    }
  }
  return best;
}

export function matchMeshesToOccurrences(
  occurrences: LogicalOccurrence[],
  meshGraph: MeshGraphNode[],
  options?: { scale?: number; maxResidual?: number }
) {
  const occ = occurrences.filter((o) => o.transform && o.transform.length === 16);
  const occT = occ.map((o) => onshapeT(o.transform as number[]));
  const nodes = meshGraph.filter((n) => n.modelMatrix && n.modelMatrix.length === 16);
  const nodeT = nodes.map((n) => threeT(n.modelMatrix));

  const scale = options?.scale ?? detectScale(occT, nodeT);
  const maxResidual = options?.maxResidual ?? Infinity;

  const pairs: { oi: number; ni: number; cost: number }[] = [];
  for (let oi = 0; oi < occ.length; oi++) {
    const so: Vec3 = [occT[oi][0] * scale, occT[oi][1] * scale, occT[oi][2] * scale];
    for (let ni = 0; ni < nodes.length; ni++) {
      pairs.push({ oi, ni, cost: dist3(so, nodeT[ni]) });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);

  const usedOcc = new Set<number>();
  const usedNode = new Set<number>();
  const assignments = new Map<string, { nodeId: string; residual: number }>();
  const residuals: number[] = [];

  for (const p of pairs) {
    if (usedOcc.has(p.oi) || usedNode.has(p.ni) || p.cost > maxResidual) continue;
    usedOcc.add(p.oi);
    usedNode.add(p.ni);
    assignments.set(occ[p.oi].pathKey, { nodeId: nodes[p.ni].nodeId, residual: p.cost });
    residuals.push(p.cost);
  }

  const mean = residuals.length
    ? residuals.reduce((s, v) => s + v, 0) / residuals.length
    : 0;
  const max = residuals.length ? Math.max(...residuals) : 0;
  return {
    scale,
    assignments,
    residualStats: { matched: residuals.length, total: occ.length, mean, max },
  };
}

export function buildPartNodeGraph(
  occurrences: LogicalOccurrence[],
  pathKeyToInstance: Map<string, MatchedInstance>,
  mateEdges: LogicalMateEdge[],
  meshGraph: MeshGraphNode[],
  options?: { scale?: number; maxResidual?: number }
) {
  const { scale, assignments, residualStats } = matchMeshesToOccurrences(
    occurrences,
    meshGraph,
    options
  );

  const nodeById = new Map(meshGraph.map((n) => [n.nodeId, n]));
  function meshDescendants(rootId: string): string[] {
    const out: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop() as string;
      const node = nodeById.get(id);
      if (!node) continue;
      if (node.isMesh) out.push(id);
      for (const c of node.children) stack.push(c);
    }
    return out;
  }

  const adj = new Map<
    string,
    { to: string; mateType: string | null; featureId: string | null }[]
  >();
  const pushEdge = (
    k: string,
    v: { to: string; mateType: string | null; featureId: string | null }
  ) => {
    const arr = adj.get(k);
    if (arr) arr.push(v);
    else adj.set(k, [v]);
  };
  for (const e of mateEdges) {
    pushEdge(e.a, { to: e.b, mateType: e.mateType, featureId: e.featureId });
    pushEdge(e.b, { to: e.a, mateType: e.mateType, featureId: e.featureId });
  }

  const nodes: PartNode[] = occurrences.map((o) => {
    const a = assignments.get(o.pathKey);
    return {
      occurrenceId: o.occurrenceId,
      pathKey: o.pathKey,
      path: o.path,
      worldTransform: o.transform,
      translation: o.translation,
      instance: pathKeyToInstance.get(o.pathKey) ?? null,
      meshNodeIds: a ? meshDescendants(a.nodeId) : [],
      matchResidual: a ? a.residual : null,
      mateEdges: adj.get(o.pathKey) ?? [],
    };
  });

  const byPathKey = new Map(nodes.map((n) => [n.pathKey, n]));
  const byMeshUuid = new Map<string, string>();
  for (const n of nodes) for (const m of n.meshNodeIds) byMeshUuid.set(m, n.pathKey);

  return { nodes, byPathKey, byMeshUuid, scale, residualStats };
}

export function getLinkedGroup(
  startPathKey: string,
  byPathKey: Map<string, PartNode>,
  maxDepth = Infinity
): string[] {
  const seen = new Set<string>([startPathKey]);
  const queue: { key: string; depth: number }[] = [{ key: startPathKey, depth: 0 }];
  const out: string[] = [];
  while (queue.length) {
    const item = queue.shift() as { key: string; depth: number };
    out.push(item.key);
    if (item.depth >= maxDepth) continue;
    const node = byPathKey.get(item.key);
    if (!node) continue;
    for (const e of node.mateEdges) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push({ key: e.to, depth: item.depth + 1 });
      }
    }
  }
  return out;
}