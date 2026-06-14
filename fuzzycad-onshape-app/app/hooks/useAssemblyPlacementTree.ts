"use client";

import { useCallback, useEffect, useState } from "react";
import type { PartPlacement } from "../components/FuzzyCADGeometryViewer";
import type { TreeGroup } from "../components/PartTree";
import {
  fetchOnshapeAssembly,
  type ApiResult,
} from "../lib/onshapeClient";

type AssemblyGraphShape = {
  assembly?: {
    documentId?: string;
    workspaceId?: string;
    assemblyElementId?: string;
    server?: string;
  };
};

export function useAssemblyPlacementTree(
  relationshipGraphResult: ApiResult | null
) {
  const [placements, setPlacements] = useState<PartPlacement[]>([]);
  const [partTree, setPartTree] = useState<TreeGroup[]>([]);

  const resetPlacementTree = useCallback(() => {
    setPlacements([]);
    setPartTree([]);
  }, []);

  useEffect(() => {
    const asm = (relationshipGraphResult?.graph as AssemblyGraphShape | undefined)
      ?.assembly;

    let cancelled = false;

    async function loadPlacementsAndTree() {
      if (!asm?.documentId || !asm?.workspaceId || !asm?.assemblyElementId) {
        if (!cancelled) {
          resetPlacementTree();
        }
        return;
      }

      try {
        const json = await fetchOnshapeAssembly({
          documentId: asm.documentId,
          workspaceId: asm.workspaceId,
          assemblyElementId: asm.assemblyElementId,
          server: asm.server || "https://cad.onshape.com",
        });

        const def = (json?.data ?? json) as {
          rootAssembly?: unknown;
          subAssemblies?: unknown;
        };

        const root = (def.rootAssembly ?? def) as {
          occurrences?: unknown;
          instances?: unknown;
        };

        const occurrences = Array.isArray(root.occurrences)
          ? root.occurrences
          : [];
        const subs = Array.isArray(def.subAssemblies) ? def.subAssemblies : [];

        const nameById = new Map<string, string>();

        const addInstanceNames = (arr: unknown) => {
          if (!Array.isArray(arr)) {
            return;
          }

          for (const inst of arr) {
            const i = inst as {
              id?: unknown;
              name?: unknown;
            };

            if (typeof i.id === "string") {
              nameById.set(i.id, typeof i.name === "string" ? i.name : i.id);
            }
          }
        };

        addInstanceNames(root.instances);

        for (const sub of subs) {
          addInstanceNames((sub as { instances?: unknown })?.instances);
        }

        const nextPlacements: PartPlacement[] = [];
        const groupsMap = new Map<string, TreeGroup>();

        for (const rawOccurrence of occurrences) {
          const occ = rawOccurrence as {
            transform?: unknown;
            path?: unknown;
          };

          if (!Array.isArray(occ.path) || occ.path.length === 0) {
            continue;
          }

          const path = occ.path as string[];
          const pathKey = path.join("/");
          const leafId = path[path.length - 1];
          const leafName = nameById.get(leafId) ?? leafId;

          const nested = path.length > 1;
          const groupKey = nested ? path[0] : "__root__";
          const groupName = nested ? nameById.get(path[0]) ?? path[0] : "Main";

          let group = groupsMap.get(groupKey);

          if (!group) {
            group = {
              key: groupKey,
              name: groupName,
              items: [],
            };
            groupsMap.set(groupKey, group);
          }

          group.items.push({
            pathKey,
            name: leafName,
          });

          if (Array.isArray(occ.transform) && occ.transform.length === 16) {
            nextPlacements.push({
              pathKey,
              partName: nameById.get(leafId) ?? null,
              transform: occ.transform as number[],
            });
          }
        }

        if (!cancelled) {
          setPlacements(nextPlacements);
          setPartTree(Array.from(groupsMap.values()));
        }
      } catch {
        if (!cancelled) {
          resetPlacementTree();
        }
      }
    }

    void loadPlacementsAndTree();

    return () => {
      cancelled = true;
    };
  }, [relationshipGraphResult, resetPlacementTree]);

  return {
    placements,
    partTree,
    resetPlacementTree,
  };
}