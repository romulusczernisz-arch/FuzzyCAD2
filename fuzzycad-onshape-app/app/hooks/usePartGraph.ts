"use client";

import { useMemo } from "react";
import type { MeshGraphNode } from "../components/FuzzyCADGeometryViewer";
import type { ApiResult } from "../lib/onshapeClient";
import {
  buildPartNodeGraph,
  getLinkedGroup,
  type LogicalOccurrence,
  type LogicalMateEdge,
  type MatchedInstance,
} from "../lib/partGraph";

type RelationshipGraphShape = {
  occurrences?: LogicalOccurrence[];
  pathMatches?: {
    occurrencePathKey: string;
    matchedInstance: MatchedInstance;
  }[];
  mateEdges?: LogicalMateEdge[];
};

type UsePartGraphArgs = {
  relationshipGraphResult: ApiResult | null;
  meshGraph: MeshGraphNode[];
  selectedMeshNode: MeshGraphNode | null;
};

export function usePartGraph({
  relationshipGraphResult,
  meshGraph,
  selectedMeshNode,
}: UsePartGraphArgs) {
  const partGraph = useMemo(() => {
    const g = relationshipGraphResult?.graph as
      | RelationshipGraphShape
      | undefined;

    if (!g?.occurrences || meshGraph.length === 0) {
      return null;
    }

    const pathKeyToInstance = new Map<string, MatchedInstance>(
      (g.pathMatches ?? []).map((match) => [
        match.occurrencePathKey,
        match.matchedInstance,
      ])
    );

    return buildPartNodeGraph(
      g.occurrences,
      pathKeyToInstance,
      g.mateEdges ?? [],
      meshGraph
    );
  }, [relationshipGraphResult, meshGraph]);

  const selectedGraphPathKey = useMemo(() => {
    if (!partGraph || !selectedMeshNode) {
      return null;
    }

    return partGraph.byMeshUuid.get(selectedMeshNode.nodeId) ?? null;
  }, [partGraph, selectedMeshNode]);

  const linkedGroup = useMemo(() => {
    if (!partGraph || !selectedGraphPathKey) {
      return null;
    }

    return getLinkedGroup(selectedGraphPathKey, partGraph.byPathKey, 1);
  }, [partGraph, selectedGraphPathKey]);

  return {
    partGraph,
    linkedGroup,
    selectedGraphPathKey,
  };
}