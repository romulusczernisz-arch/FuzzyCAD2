"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import styles from "./fuzzycad-home.module.css";
import FuzzyCADSidebar from "./components/FuzzyCADSidebar";
import DevPanel from "./components/DevPanel";
import { useAssemblyPlacementTree } from "./hooks/useAssemblyPlacementTree";
import type {
  AxialStretchObjectSummary,
  MeshGraphNode,
  RolePreviewPlan,
} from "./components/FuzzyCADGeometryViewer";
import { usePartGraph } from "./hooks/usePartGraph";
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
import type { OperationTool } from "./lib/operations/types";
import OperationToolbar from "./components/OperationToolbar";
import { buildCompactAxialStretchContext } from "./lib/operations/compactAxialStretchContext";
import { inferCompactAxialStretchPlan } from "./lib/operations/inferCompactAxialStretchPlan";
import { resolveCompactAxialStretchPlan } from "./lib/operations/resolveCompactAxialStretchPlan";

const FuzzyCADGeometryViewer = dynamic(
  () => import("./components/FuzzyCADGeometryViewer"),
  {
    ssr: false,
  },
);

function isElementArray(data: unknown): data is OnshapeElement[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "name" in item,
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
  const [objectSummaries, setObjectSummaries] = useState<
    AxialStretchObjectSummary[]
  >([]);
  const [selectedMeshNode, setSelectedMeshNode] =
    useState<MeshGraphNode | null>(null);

  const [highlightedPathKey, setHighlightedPathKey] = useState<string | null>(
    null,
  );
  const [lassoPathKeys, setLassoPathKeys] = useState<string[]>([]);

  const { placements, partTree, resetPlacementTree } = useAssemblyPlacementTree(
    relationshipGraphResult,
  );

  const { partGraph, linkedGroup, selectedGraphPathKey } = usePartGraph({
    relationshipGraphResult,
    meshGraph,
    selectedMeshNode,
  });

  const selectedPathKeysForPlanning = useMemo(() => {
    if (lassoPathKeys.length > 0) {
      return lassoPathKeys;
    }

    return highlightedPathKey ? [highlightedPathKey] : [];
  }, [lassoPathKeys, highlightedPathKey]);

  const compactAxialStretchContext = useMemo(
    () =>
      buildCompactAxialStretchContext(
        objectSummaries,
        selectedPathKeysForPlanning,
      ),
    [objectSummaries, selectedPathKeysForPlanning],
  );

  const draftAxialStretchPlan = useMemo(
    () => inferCompactAxialStretchPlan(compactAxialStretchContext),
    [compactAxialStretchContext],
  );

  const resolvedAxialStretchPlan = useMemo(
    () =>
      resolveCompactAxialStretchPlan(
        draftAxialStretchPlan,
        compactAxialStretchContext,
      ),
    [draftAxialStretchPlan, compactAxialStretchContext],
  );

  const [dev, setDev] = useState<boolean>(() => params.get("dev") === "1");
  const [busy, setBusy] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<OperationTool>("select");
  const [pendingHeightRolePreview, setPendingHeightRolePreview] =
    useState<RolePreviewPlan | null>(null);

  const [heightPreviewOpen, setHeightPreviewOpen] = useState(false);

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
    documentId || "",
  )}&workspaceId=${encodeURIComponent(
    workspaceId || "",
  )}&elementId=${encodeURIComponent(
    elementId || "",
  )}&server=${encodeURIComponent(server)}`;

  useEffect(() => {
    if (documentId && workspaceId) {
      void loadElements();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, workspaceId]);

  function resetGeometryState() {
    setMeshGraph([]);
    setObjectSummaries([]);
    setSelectedMeshNode(null);
    setHighlightedPathKey(null);
    setLassoPathKeys([]);
    setGeometryLoadResult(null);
    resetPlacementTree();

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
        (element) => element.elementType === "ASSEMBLY",
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

function startHeightPreview() {
  setActiveTool("height");

  console.log("Height preview input", {
    selectedPathKeysForPlanning,
    resolvedAxialStretchPlan,
  });

    if (
      selectedPathKeysForPlanning.length === 0 ||
      resolvedAxialStretchPlan.stretchTargetPathKeys.length === 0
    ) {
      setPendingHeightRolePreview(null);
      setHeightPreviewOpen(false);
      return;
    }

    setPendingHeightRolePreview({
      stretchTargetPathKeys: resolvedAxialStretchPlan.stretchTargetPathKeys,
      moveWithEndPathKeys: resolvedAxialStretchPlan.moveWithEndPathKeys,
      fixedAnchorPathKeys: resolvedAxialStretchPlan.fixedAnchorPathKeys,
      excludedPathKeys: resolvedAxialStretchPlan.excludedPathKeys,
    });

    setHeightPreviewOpen(true);
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
        clickedPathKey: selectedGraphPathKey,
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
          selectedPathKeys={lassoPathKeys}
          activeTool={activeTool}
          rolePreviewPlan={pendingHeightRolePreview}
          enableManipulationHandles={!heightPreviewOpen}
          onMeshGraph={setMeshGraph}
          onObjectSummaries={setObjectSummaries}
          onSelectedNode={setSelectedMeshNode}
          onSelectedPathKey={setHighlightedPathKey}
          onObjectLassoSelection={(pathKeys) => {
            setLassoPathKeys(pathKeys);
            setHighlightedPathKey(pathKeys[0] ?? null);
          }}
        />

        <OperationToolbar
          activeTool={activeTool}
          disabled={!gltfUrl}
          onToolChange={(tool) => {
            if (tool === "height") {
              startHeightPreview();
              return;
            }

            setActiveTool(tool);
            setPendingHeightRolePreview(null);
            setHeightPreviewOpen(false);

            if (tool === "select") {
              setLassoPathKeys([]);
            }
          }}
        />
        {heightPreviewOpen && pendingHeightRolePreview ? (
          <div
            style={{
              position: "absolute",
              top: 80,
              left: "50%",
              transform: "translateX(-50%)",
              background: "white",
              border: "1px solid rgba(0,0,0,0.18)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              padding: 12,
              zIndex: 20,
              width: 280,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Height Operation Preview
            </div>

            <div>
              Stretch: {pendingHeightRolePreview.stretchTargetPathKeys.length}
            </div>
            <div>
              Follow: {pendingHeightRolePreview.moveWithEndPathKeys.length}
            </div>
            <div>
              Fixed: {pendingHeightRolePreview.fixedAnchorPathKeys.length}
            </div>
            <div>
              Excluded: {pendingHeightRolePreview.excludedPathKeys.length}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setHeightPreviewOpen(false);
                }}
              >
                Confirm
              </button>

              <button
                type="button"
                onClick={() => {
                  setPendingHeightRolePreview(null);
                  setHeightPreviewOpen(false);
                  setActiveTool("select");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
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
            {
              title: "Object Summary Stats",
              value: {
                totalObjectSummaries: objectSummaries.length,
                selectedByLasso: objectSummaries.filter(
                  (item) => item.selectedByLasso,
                ).length,
              },
            },
            {
              title: "Compact AI Context",
              value: compactAxialStretchContext.aiPayload,
            },
            {
              title: "Draft Axial Stretch Plan",
              value: draftAxialStretchPlan,
            },
            {
              title: "Resolved Axial Stretch Plan",
              value: resolvedAxialStretchPlan,
            },
            {
              title: "Compact Alias Map",
              value: compactAxialStretchContext.aliasMap,
            },
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
