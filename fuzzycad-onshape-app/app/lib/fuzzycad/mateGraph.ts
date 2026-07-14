/**
 * Utilities for traversing the assembly mate graph.
 *
 * The relationship graph from /api/fuzzycad/assembly-data returns `mateEdges`,
 * each with `a` and `b` as occurrence pathKeys (path.join("/") format) and
 * a `mateType` string (FASTENED, REVOLUTE, etc.).
 */

export type MateGraphEdge = {
  a: string;
  b: string;
  mateType?: string | null;
};

/**
 * Build an adjacency map from a list of mate edges.
 */
function buildAdjacency(edges: MateGraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.a)) adj.set(edge.a, []);
    if (!adj.has(edge.b)) adj.set(edge.b, []);
    adj.get(edge.a)!.push(edge.b);
    adj.get(edge.b)!.push(edge.a);
  }
  return adj;
}

/**
 * Find all occurrence pathKeys reachable from `startPathKey` via mate edges,
 * without crossing `excludePathKey` (the fixed reference part).
 *
 * Returns the connected group (excluding startPathKey itself and excludePathKey).
 *
 * Uses BFS over all mate types — physically models the scenario where the
 * entire rigid body group connected to part2 moves together when the angle
 * changes.
 */
export function findMateConnectedParts(
  startPathKey: string,
  excludePathKey: string,
  edges: MateGraphEdge[],
): string[] {
  const adj = buildAdjacency(edges);
  const visited = new Set<string>([startPathKey, excludePathKey]);
  const queue: string[] = [startPathKey];
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adj.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      result.push(neighbor);
      queue.push(neighbor);
    }
  }

  return result;
}
