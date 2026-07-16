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
 * Mate types that connect two occurrences into one rigid body. Motion applied
 * to one side must carry the other side along.
 *
 * Everything else (REVOLUTE, SLIDER, CYLINDRICAL, PLANAR, BALL, PIN_SLOT,
 * PARALLEL, TANGENT, ...) leaves at least one degree of freedom, so the joint
 * absorbs the motion and propagation stops there.
 */
const RIGID_MATE_TYPES = new Set(["FASTENED", "FIXED", "GROUP", "RIGID"]);

function isRigidMateType(mateType: string | null | undefined) {
  if (typeof mateType !== "string" || mateType.length === 0) {
    // Unknown mate type: treat as rigid so we fail toward "moves together",
    // matching the previous all-mates-rigid behavior for unlabeled edges.
    return true;
  }
  return RIGID_MATE_TYPES.has(mateType.toUpperCase());
}

/**
 * Find all occurrence pathKeys reachable from `startPathKey` via mate edges,
 * without crossing `excludePathKey` (the fixed reference part).
 *
 * Returns the connected group (excluding startPathKey itself and excludePathKey).
 *
 * By default only rigid mate types propagate (see RIGID_MATE_TYPES) — a part
 * fastened to part2 rotates with it, but a part connected via a revolute or
 * slider joint does not, because that joint absorbs the motion. Pass
 * `options.allMateTypes: true` to restore the old propagate-everything
 * behavior.
 */
export function findMateConnectedParts(
  startPathKey: string,
  excludePathKey: string,
  edges: MateGraphEdge[],
  options?: { allMateTypes?: boolean },
): string[] {
  const usableEdges = options?.allMateTypes
    ? edges
    : edges.filter((edge) => isRigidMateType(edge.mateType));

  const adj = buildAdjacency(usableEdges);
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
