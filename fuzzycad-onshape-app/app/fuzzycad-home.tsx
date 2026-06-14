"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import styles from "./fuzzycad-home.module.css";
import FuzzyCADSidebar from "./components/FuzzyCADSidebar";
import DevPanel from "./components/DevPanel";
import type {
  MeshGraphNode,
  PartPlacement,
} from "./components/FuzzyCADGeometryViewer";
import {
  buildPartNodeGraph,
  getLinkedGroup,
  type LogicalOccurrence,
  type LogicalMateEdge,
  type MatchedInstance,
} from "./lib/partGraph";
import { type TreeGroup } from "./components/PartTree";
import {
  fetchFuzzycadAssemblySummary,
  fetchFuzzycadRelationshipGraph,
  fetchOnshapeAssembly,
  fetchOnshapeAssemblyGltf,
  fetchOnshapeAssemblyZipManifest,
  fetchOnshapeElements,
  type ApiResult,
  type OnshapeElement,
} from "./lib/onshapeClient";

const FuzzyCADGeometryViewer = dynamic(
  () => import("./components/FuzzyCADGeometryViewer"),
  {
    ssr: false,
  }
);





function isElementArray(data: unknown): data is OnshapeElement[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "name" in item
    )
  );
}

export default function FuzzyCADHome() {
  const params = useSearchParams();
  const allParams = Array.from(params.entries());

  const [elementsResult, setElementsResult] = useState<ApiResult | null>(null);
  const [assemblyResult, setAssemblyResult] = useState<ApiResult | null>(null);
  const [assemblySummaryResult, setAssemblySummaryResult] =
    useState<ApiResult | null>(null);
  const [relationshipGraphResult, setRelationshipGraphResult] =
    useState<ApiResult | null>(null);

  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string>("");

  const [gltfUrl, setGltfUrl] = useState<string | null>(null);
  const [geometryLoadResult, setGeometryLoadResult] =
    useState<ApiResult | null>(null);
  const [geometryZipManifest, setGeometryZipManifest] =
    useState<ApiResult | null>(null);

  const [meshGraph, setMeshGraph] = useState<MeshGraphNode[]>([]);
  const [selectedMeshNode, setSelectedMeshNode] =
    useState<MeshGraphNode | null>(null);

  const [placements, setPlacements] = useState<PartPlacement[]>([]);
  const [partTree, setPartTree] = useState<TreeGroup[]>([]);
  const [highlightedPathKey, setHighlightedPathKey] = useState<string | null>(
    null
  );

  const [dev, setDev] = useState<boolean>(() => params.get("dev") === "1");
  const [busy, setBusy] = useState<boolean>(false);

  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");
  const server = params.get("server") || "https://cad.onshape.com";
  const oauthStatus = params.get("oauth");

  const assemblyElements = useMemo(() => {
    const data = elementsResult?.data;

    if (!isElementArray(data)) {
      return [];
    }

    return data.filter((element) => element.elementType === "ASSEMBLY");
  }, [elementsResult]);

  const connectHref = `/api/oauth/start?documentId=${encodeURIComponent(
    documentId || ""
  )}&workspaceId=${encodeURIComponent(
    workspaceId || ""
  )}&elementId=${encodeURIComponent(
    elementId || ""
  )}&server=${encodeURIComponent(server)}`;

  const partGraph = useMemo(() => {
    const g = relationshipGraphResult?.graph as
      | {
          occurrences?: LogicalOccurrence[];
          pathMatches?: {
            occurrencePathKey: string;
            matchedInstance: MatchedInstance;
          }[];
          mateEdges?: LogicalMateEdge[];
        }
      | undefined;

    if (!g?.occurrences || meshGraph.length === 0) {
      return null;
    }

    const pathKeyToInstance = new Map<string, MatchedInstance>(
      (g.pathMatches ?? []).map((m) => [m.occurrencePathKey, m.matchedInstance])
    );

    return buildPartNodeGraph(
      g.occurrences,
      pathKeyToInstance,
      g.mateEdges ?? [],
      meshGraph
    );
  }, [relationshipGraphResult, meshGraph]);

  const linkedGroup = useMemo(() => {
    if (!partGraph || !selectedMeshNode) {
      return null;
    }

    const pathKey = partGraph.byMeshUuid.get(selectedMeshNode.nodeId);

    if (!pathKey) {
      return null;
    }

    return getLinkedGroup(pathKey, partGraph.byPathKey, 1);
  }, [partGraph, selectedMeshNode]);

  useEffect(() => {
    const asm = (
      relationshipGraphResult?.graph as
        | {
            assembly?: {
              documentId?: string;
              workspaceId?: string;
              assemblyElementId?: string;
              server?: string;
            };
          }
        | undefined
    )?.assembly;

    let cancelled = false;

    async function loadPlacementsAndTree() {
      if (!asm?.documentId || !asm?.workspaceId || !asm?.assemblyElementId) {
        if (!cancelled) {
          setPlacements([]);
          setPartTree([]);
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


        const occurrences = Array.isArray(root?.occurrences)
          ? root.occurrences
          : [];
        const subs = Array.isArray(def?.subAssemblies) ? def.subAssemblies : [];

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

        addInstanceNames(root?.instances);

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
          const groupName = nested
            ? nameById.get(path[0]) ?? path[0]
            : "Main";

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
          setPlacements([]);
          setPartTree([]);
        }
      }
    }

    void loadPlacementsAndTree();

    return () => {
      cancelled = true;
    };
  }, [relationshipGraphResult]);

  useEffect(() => {
    if (documentId && workspaceId) {
      void loadElements();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, workspaceId]);

  function resetGeometryState() {
    setMeshGraph([]);
    setSelectedMeshNode(null);
    setHighlightedPathKey(null);
    setGeometryLoadResult(null);

    if (gltfUrl) {
      URL.revokeObjectURL(gltfUrl);
      setGltfUrl(null);
    }
  }

  async function loadAssemblyGeometry() {
    resetGeometryState();

const res = await fetchOnshapeAssemblyGltf({
  documentId: documentId || "",
  workspaceId: workspaceId || "",
  assemblyElementId: selectedAssemblyId,
  server,
});
    const contentType = res.headers.get("content-type") || "";

    if (
      res.ok &&
      (contentType.includes("model/gltf-binary") ||
        contentType.includes("model/gltf+json"))
    ) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      setGltfUrl(url);
      setGeometryLoadResult({
        status: res.status,
        ok: true,
        data: {
          contentType,
          size: blob.size,
          zipMode: res.headers.get("x-fuzzycad-zip-mode"),
          extractedFile: res.headers.get("x-fuzzycad-extracted-file"),
          gltfCandidates: res.headers.get("x-fuzzycad-gltf-candidates"),
          selectedNodes: res.headers.get("x-fuzzycad-selected-nodes"),
          selectedMeshes: res.headers.get("x-fuzzycad-selected-meshes"),
          selectedScenes: res.headers.get("x-fuzzycad-selected-scenes"),
          translationId: res.headers.get("x-fuzzycad-translation-id"),
          externalDataId: res.headers.get("x-fuzzycad-external-data-id"),
        },
      });

      return;
    }

    const data = (await res.json()) as ApiResult;
    setGeometryLoadResult(data);
  }

  async function inspectAssemblyGeometryZip() {
    setGeometryZipManifest(null);

const data = await fetchOnshapeAssemblyZipManifest({
  documentId: documentId || "",
  workspaceId: workspaceId || "",
  assemblyElementId: selectedAssemblyId,
  server,
});

setGeometryZipManifest(data);
  }

  async function loadElements() {
const data = await fetchOnshapeElements({
  documentId: documentId || "",
  workspaceId: workspaceId || "",
  server,
});

    setElementsResult(data);

    if (data.ok && isElementArray(data.data)) {
      const firstAssembly = data.data.find(
        (element) => element.elementType === "ASSEMBLY"
      );

      if (firstAssembly) {
        setSelectedAssemblyId(firstAssembly.id);
      }
    }
  }

  async function loadAssemblyDefinition() {
   const data = await fetchOnshapeAssembly({
  documentId: documentId || "",
  workspaceId: workspaceId || "",
  assemblyElementId: selectedAssemblyId,
  server,
});

setAssemblyResult(data);
  }

  async function loadAssemblySummary() {
   const data = await fetchFuzzycadAssemblySummary({
  documentId: documentId || "",
  workspaceId: workspaceId || "",
  assemblyElementId: selectedAssemblyId,
  server,
});

setAssemblySummaryResult(data);
  }

  async function buildRelationshipGraph() {
const data = await fetchFuzzycadRelationshipGraph({
  documentId: documentId || "",
  workspaceId: workspaceId || "",
  assemblyElementId: selectedAssemblyId,
  server,
});

setRelationshipGraphResult(data);
  }

  async function loadSelectedAssembly() {
    if (!selectedAssemblyId) {
      return;
    }

    setBusy(true);

    try {
      await buildRelationshipGraph();
      await loadAssemblyGeometry();
    } finally {
      setBusy(false);
    }
  }

  function handleAssemblyChange(assemblyId: string) {
  setSelectedAssemblyId(assemblyId);
  resetGeometryState();
  setGeometryZipManifest(null);
}

const devGraphStats = partGraph
  ? {
      matched: partGraph.residualStats.matched,
      total: partGraph.residualStats.total,
      scale: partGraph.scale,
      clickedPathKey: selectedMeshNode
        ? partGraph.byMeshUuid.get(selectedMeshNode.nodeId) ?? "—"
        : null,
      linkedCount: linkedGroup ? linkedGroup.length : null,
    }
  : null;

  const connected = oauthStatus === "connected" || assemblyElements.length > 0;

  return (
<main className={styles.root}>
      
<FuzzyCADSidebar
  connected={connected}
  connectHref={connectHref}
  assemblyElements={assemblyElements}
  selectedAssemblyId={selectedAssemblyId}
  busy={busy}
  partTree={partTree}
  highlightedPathKey={highlightedPathKey}
  dev={dev}
  onAssemblyChange={handleAssemblyChange}
  onLoadAssembly={loadSelectedAssembly}
  onSelectPathKey={setHighlightedPathKey}
  onToggleDev={() => {
    setDev((value) => !value);
  }}
/>

      

<div className={styles.viewerPane}>
  <FuzzyCADGeometryViewer
  gltfUrl={gltfUrl}
  placements={placements}
  highlightedPathKey={highlightedPathKey}
  onMeshGraph={setMeshGraph}
  onSelectedNode={setSelectedMeshNode}
 onSelectedPathKey={setHighlightedPathKey}
/>
      </div>

{dev ? (
  <DevPanel
    connectHref={connectHref}
    selectedAssemblyId={selectedAssemblyId}
    graphStats={devGraphStats}
    meshGraph={meshGraph}
    debugResults={[
  { title: "Relationship Graph", value: relationshipGraphResult },
  { title: "Assembly Summary", value: assemblySummaryResult },
  { title: "Raw Assembly", value: assemblyResult },
  { title: "Elements", value: elementsResult },
  { title: "Geometry Load", value: geometryLoadResult },
  { title: "Geometry ZIP", value: geometryZipManifest },
]}
    allParams={allParams}
    onClose={() => {
      setDev(false);
    }}
    onLoadElements={loadElements}
    onLoadRawAssembly={loadAssemblyDefinition}
    onLoadSummary={loadAssemblySummary}
    onBuildGraph={buildRelationshipGraph}
    onLoadGeometry={loadAssemblyGeometry}
    onInspectZip={inspectAssemblyGeometryZip}
  />
) : null}
    </main>
  );
}