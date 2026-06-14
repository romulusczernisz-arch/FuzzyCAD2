"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import styles from "./fuzzycad-home.module.css";
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
import PartTree, { type TreeGroup } from "./components/PartTree";

const FuzzyCADGeometryViewer = dynamic(
  () => import("./components/FuzzyCADGeometryViewer"),
  {
    ssr: false,
  }
);

type OnshapeElement = {
  id: string;
  name: string;
  type?: string;
  elementType?: string;
  dataType?: string;
};

type ApiResult = {
  endpoint?: string;
  status?: number;
  ok?: boolean;
  data?: unknown;
  graph?: unknown;
  error?: string;
  action?: string;
  details?: unknown;
  counts?: unknown;
  occurrencesPreview?: unknown;
  instancesPreview?: unknown;
  featuresPreview?: unknown;
  manifest?: unknown;
  mode?: string;
  message?: string;
};



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

      const base = new URLSearchParams({
        documentId: asm.documentId,
        workspaceId: asm.workspaceId,
        assemblyElementId: asm.assemblyElementId,
        server: asm.server || "https://cad.onshape.com",
      });

      try {
        const res = await fetch("/api/onshape/assembly?" + base.toString());
        const json = await res.json();

        const def = json?.data ?? json;
        const root = def?.rootAssembly ?? def;
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
            : "(顶层零件)";

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

    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });

    const res = await fetch(`/api/onshape/assembly-gltf?${query.toString()}`);
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

    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      debugZip: "1",
    });

    const res = await fetch(`/api/onshape/assembly-gltf?${query.toString()}`);
    const data = (await res.json()) as ApiResult;

    setGeometryZipManifest(data);
  }

  async function loadElements() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      server,
    });

    const res = await fetch(`/api/onshape/elements?${query.toString()}`);
    const data = (await res.json()) as ApiResult;

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
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });

    const res = await fetch(`/api/onshape/assembly?${query.toString()}`);
    const data = (await res.json()) as ApiResult;

    setAssemblyResult(data);
  }

  async function loadAssemblySummary() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });

    const res = await fetch(
      `/api/fuzzycad/assembly-summary?${query.toString()}`
    );
    const data = (await res.json()) as ApiResult;

    setAssemblySummaryResult(data);
  }

  async function buildRelationshipGraph() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });

    const res = await fetch(
      `/api/fuzzycad/relationship-graph?${query.toString()}`
    );
    const data = (await res.json()) as ApiResult;

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

  const connected = oauthStatus === "connected" || assemblyElements.length > 0;

  return (
<main className={styles.root}>
      <aside className={styles.sidebar}>
       <div className={styles.brand}>FuzzyCAD</div>

        {!connected ? (
         <a href={connectHref} className={styles.connectButton}>
  Connect to Onshape
</a>
        ) : null}

        {assemblyElements.length > 0 ? (
          <>
           <label className={styles.assemblyLabel}>Assembly</label>

<select
  value={selectedAssemblyId}
  onChange={(event) => {
    setSelectedAssemblyId(event.target.value);
    resetGeometryState();
    setGeometryZipManifest(null);
  }}
  className={styles.assemblySelect}
>
              {assemblyElements.map((assembly) => (
                <option key={assembly.id} value={assembly.id}>
                  {assembly.name}
                </option>
              ))}
            </select>

<button
  onClick={loadSelectedAssembly}
  disabled={!selectedAssemblyId || busy}
  className={styles.primaryButton}
>
  {busy ? "Loading..." : "Loading assembly"}
</button>
          </>
        ) : (
          <p className={styles.emptyMessage}>
  {connected ? "Assembly not found." : "Please connect Onshape first."}
</p>
        )}

<PartTree
  groups={partTree}
  selectedPathKey={highlightedPathKey}
  onSelectPathKey={setHighlightedPathKey}
/>

        <button
  onClick={() => {
    setDev((value) => !value);
  }}
  className={styles.secondaryButton}
>
  {dev ? "Hide Debug Panel" : "Debug Panel"}
</button>
      </aside>

<div className={styles.viewerPane}>
  <FuzzyCADGeometryViewer
  gltfUrl={gltfUrl}
  placements={placements}
  highlightedPathKey={highlightedPathKey}
  onMeshGraph={setMeshGraph}
  onSelectedNode={setSelectedMeshNode}
  onSelectedPathKey={(pathKey) => {
    setHighlightedPathKey(pathKey);
  }}
/>
      </div>

      {dev ? (
       <div className={styles.devOverlay}>
<button
  onClick={() => {
    setDev(false);
  }}
  className={styles.devCloseButton}
>
  Close
</button>

          <h2>Actions</h2>

         <div className={styles.devActions}>
            <a href={connectHref}>Connect Onshape</a>

            <button onClick={loadElements}>Load Elements</button>

            <button
              onClick={loadAssemblyDefinition}
              disabled={!selectedAssemblyId}
            >
              Raw Assembly
            </button>

            <button
              onClick={loadAssemblySummary}
              disabled={!selectedAssemblyId}
            >
              Summary
            </button>

            <button
              onClick={buildRelationshipGraph}
              disabled={!selectedAssemblyId}
            >
              Build Graph
            </button>

            <button
              onClick={loadAssemblyGeometry}
              disabled={!selectedAssemblyId}
            >
              Load Geometry
            </button>

            <button
              onClick={inspectAssemblyGeometryZip}
              disabled={!selectedAssemblyId}
            >
              Inspect ZIP
            </button>
          </div>

{partGraph ? (
  <p className={styles.devStats}>
    Matched: {partGraph.residualStats.matched}/
    {partGraph.residualStats.total} · scale {partGraph.scale}
    {selectedMeshNode ? (
      <>
        {" "}
        · clicked{" "}
        {partGraph.byMeshUuid.get(selectedMeshNode.nodeId) ?? "—"}
        {linkedGroup ? <> · linked {linkedGroup.length}</> : null}
      </>
    ) : null}
  </p>
) : null}   

          {meshGraph.length > 0 ? (
            <p>
              Objects: {meshGraph.length}; Mesh:{" "}
              {meshGraph.filter((node) => node.isMesh).length}
            </p>
          ) : null}

         {(
  [
    ["Relationship Graph", relationshipGraphResult],
    ["Assembly Summary", assemblySummaryResult],
    ["Raw Assembly", assemblyResult],
    ["Elements", elementsResult],
    ["Geometry Load", geometryLoadResult],
    ["Geometry ZIP", geometryZipManifest],
  ] as [string, ApiResult | null][]
).map(([title, value]) =>
  value ? (
    <details key={title} className={styles.debugDetails}>
      <summary className={styles.debugSummary}>{title}</summary>

      <pre className={styles.debugPre}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  ) : null
)}

         <details className={styles.debugDetails}>
  <summary className={styles.debugSummary}>
    All URL Parameters
  </summary>

  <table className={styles.paramsTable}>
              <tbody>
                {allParams.map(([key, value]) => (
                  <tr key={key}>
                  <td className={styles.paramsCell}>{key}</td>
<td className={styles.paramsCell}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : null}
    </main>
  );
}