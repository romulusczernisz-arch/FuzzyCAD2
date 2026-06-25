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
import OperationPreviewPanel, {
  type OperationAxis,
  type OperationDirection,
} from "./components/OperationPreviewPanel";
import { buildCompactAxialStretchContext } from "./lib/operations/compactAxialStretchContext";
import { inferCompactAxialStretchPlan } from "./lib/operations/inferCompactAxialStretchPlan";
import { resolveCompactAxialStretchPlan } from "./lib/operations/resolveCompactAxialStretchPlan";
import {
  DEFAULT_HEIGHT_CONFIDENCE,
  type AxisConfidenceMap,
  type ConfidenceAxis,
  type ConfidenceLevel,
  type FuzzyConfidenceAnnotation,
} from "./lib/uncertainty/types";

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

function normalizeObjectName(name: string | null) {
  if (!name) {
    return "";
  }

  return name
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/g, "")
    .replace(/[_\-\s]*\d+\s*$/g, "")
    .trim();
}

function buildHeightCandidatePathKeys(
  selectedSummary: AxialStretchObjectSummary,
  objectSummaries: AxialStretchObjectSummary[],
) {
  const selectedName = normalizeObjectName(selectedSummary.name);

  const candidateSet = new Set<string>();

  candidateSet.add(selectedSummary.pathKey);

  for (const summary of objectSummaries) {
    if (summary.pathKey === selectedSummary.pathKey) {
      continue;
    }

    const sameSemanticName =
      selectedName.length > 0 && normalizeObjectName(summary.name) === selectedName;

    const geometricallySimilar = selectedSummary.similarPathKeys.includes(
      summary.pathKey,
    );

    if (sameSemanticName || geometricallySimilar) {
      candidateSet.add(summary.pathKey);
    }
  }

  return Array.from(candidateSet);
}

function getObjectDisplayName(summary: AxialStretchObjectSummary) {
  return summary.name || summary.pathKey;
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
  const [confirmedHeightPlan, setConfirmedHeightPlan] =
    useState<RolePreviewPlan | null>(null);
  const [manipulationValue, setManipulationValue] = useState(0);

  const [heightPreviewOpen, setHeightPreviewOpen] = useState(false);
  const [pendingHeightAxis, setPendingHeightAxis] =
    useState<OperationAxis>("y");
  const [pendingHeightDirection, setPendingHeightDirection] =
    useState<OperationDirection>("positive");

  const [heightCandidateOpen, setHeightCandidateOpen] = useState(false);
  const [heightCandidatePathKeys, setHeightCandidatePathKeys] = useState<
    string[]
  >([]);
  const [heightConfidenceOpen, setHeightConfidenceOpen] = useState(false);
  const [confidenceDraft, setConfidenceDraft] = useState<AxisConfidenceMap>(
    DEFAULT_HEIGHT_CONFIDENCE,
  );
  const [confidenceAnnotations, setConfidenceAnnotations] = useState<
    FuzzyConfidenceAnnotation[]
  >([]);

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

  const selectedObjectSummary = useMemo(() => {
    if (!highlightedPathKey) {
      return null;
    }

    return (
      objectSummaries.find((summary) => summary.pathKey === highlightedPathKey) ??
      null
    );
  }, [highlightedPathKey, objectSummaries]);

  const heightCandidateSummaries = useMemo(() => {
    return heightCandidatePathKeys
      .map((pathKey) =>
        objectSummaries.find((summary) => summary.pathKey === pathKey),
      )
      .filter(
        (summary): summary is AxialStretchObjectSummary => summary !== undefined,
      );
  }, [heightCandidatePathKeys, objectSummaries]);

  const heightReferencePathKey =
    heightCandidatePathKeys[0] ?? highlightedPathKey ?? null;

  const viewerSelectedPathKeys = useMemo(() => {
    if (heightCandidateOpen) {
      return heightCandidatePathKeys;
    }

    if (heightConfidenceOpen && heightReferencePathKey) {
      return [heightReferencePathKey];
    }

    return lassoPathKeys;
  }, [
    heightCandidateOpen,
    heightConfidenceOpen,
    heightCandidatePathKeys,
    heightReferencePathKey,
    lassoPathKeys,
  ]);

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
    setPendingHeightRolePreview(null);
    setConfirmedHeightPlan(null);
    setHeightPreviewOpen(false);
    setManipulationValue(0);
    setActiveTool("select");
    setHeightCandidateOpen(false);
    setHeightCandidatePathKeys([]);
    setHeightConfidenceOpen(false);
    setConfidenceDraft(DEFAULT_HEIGHT_CONFIDENCE);
    setConfidenceAnnotations([]);
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

  function startHeightUncertainty() {
    setActiveTool("height");
    setPendingHeightRolePreview(null);
    setConfirmedHeightPlan(null);
    setManipulationValue(0);
    setHeightPreviewOpen(false);
    setHeightConfidenceOpen(false);
    setLassoPathKeys([]);

    if (!selectedObjectSummary) {
      setHeightCandidateOpen(true);
      setHeightCandidatePathKeys([]);
      return;
    }

    const candidates = buildHeightCandidatePathKeys(
      selectedObjectSummary,
      objectSummaries,
    );

    setHeightCandidatePathKeys(candidates);
    setHeightCandidateOpen(true);
  }

  function confirmHeightCandidateGroup() {
    if (heightCandidatePathKeys.length === 0) {
      setHeightCandidateOpen(false);
      setHeightConfidenceOpen(false);
      return;
    }

    setHeightCandidateOpen(false);
    setHeightConfidenceOpen(true);
    setConfidenceDraft(DEFAULT_HEIGHT_CONFIDENCE);
  }

  function cancelHeightCandidateGroup() {
    setHeightCandidateOpen(false);
    setHeightCandidatePathKeys([]);
    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function applyHeightConfidence() {
    const targetPathKey = heightReferencePathKey;

    if (!targetPathKey) {
      setHeightConfidenceOpen(false);
      return;
    }

    setConfidenceAnnotations((previous) => [
      ...previous.filter((item) => item.pathKey !== targetPathKey),
      {
        pathKey: targetPathKey,
        confidence: confidenceDraft,
      },
    ]);

    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function updateConfidenceDraft(
    axis: ConfidenceAxis,
    confidence: ConfidenceLevel,
  ) {
    setConfidenceDraft((previous) => ({
      ...previous,
      [axis]: confidence,
    }));
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
          selectedPathKeys={viewerSelectedPathKeys}
          activeTool={activeTool}
          rolePreviewPlan={pendingHeightRolePreview}
          confirmedHeightPlan={confirmedHeightPlan}
          enableManipulationHandles={!heightPreviewOpen && Boolean(confirmedHeightPlan)}
          manipulationValue={manipulationValue}
          confidenceAnnotations={confidenceAnnotations}
          onManipulationChange={setManipulationValue}
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
              startHeightUncertainty();
              return;
            }

            setActiveTool(tool);
            setPendingHeightRolePreview(null);
            setConfirmedHeightPlan(null);
            setManipulationValue(0);
            setHeightPreviewOpen(false);
            setHeightCandidateOpen(false);
            setHeightCandidatePathKeys([]);
            setHeightConfidenceOpen(false);

            if (tool === "select") {
              setLassoPathKeys([]);
            }
          }}
        />

        {heightCandidateOpen ? (
          <OperationPreviewPanel
            operation="height"
            title={
              heightCandidatePathKeys.length > 0
                ? "Related leg objects detected"
                : "Select one leg first"
            }
            description={
              heightCandidatePathKeys.length > 0
                ? "FuzzyCAD found objects with similar names or similar geometry. Confirm to treat them as related tripod legs, then annotate the selected reference leg."
                : "Click one existing tripod leg in the viewer, then click Height again."
            }
            suggestedObjects={heightCandidateSummaries.map(getObjectDisplayName)}
            confirmLabel={
              heightCandidatePathKeys.length > 0 ? "Confirm group" : "OK"
            }
            cancelLabel="Cancel"
            onConfirm={confirmHeightCandidateGroup}
            onCancel={cancelHeightCandidateGroup}
          />
        ) : null}

        {heightConfidenceOpen ? (
          <OperationPreviewPanel
            operation="height"
            title="Mark leg confidence"
            description="Set confidence for the selected reference leg. Low confidence creates a stronger blurry 3D ghost along that axis; medium confidence creates a lighter haze; high confidence stays sharp."
            showConfidenceControls
            axisConfidence={confidenceDraft}
            confirmLabel="Apply blur"
            cancelLabel="Cancel"
            onConfidenceChange={updateConfidenceDraft}
            onConfirm={applyHeightConfidence}
            onCancel={() => {
              setHeightConfidenceOpen(false);
              setActiveTool("select");
            }}
          />
        ) : null}

        {heightPreviewOpen && pendingHeightRolePreview ? (
          <OperationPreviewPanel
            operation="height"
            title="Height operation preview"
            description="Review the inferred stretch targets, followers, and fixed anchors before applying the height operation."
            showAxisControls
            axis={pendingHeightAxis}
            direction={pendingHeightDirection}
            onAxisChange={setPendingHeightAxis}
            onDirectionChange={setPendingHeightDirection}
            roleCounts={{
              stretchTarget:
                pendingHeightRolePreview.stretchTargetPathKeys.length,
              moveWithEnd: pendingHeightRolePreview.moveWithEndPathKeys.length,
              fixedAnchor: pendingHeightRolePreview.fixedAnchorPathKeys.length,
              excluded: pendingHeightRolePreview.excludedPathKeys.length,
            }}
            onConfirm={() => {
              setConfirmedHeightPlan(pendingHeightRolePreview);
              setManipulationValue(0);
              setHeightPreviewOpen(false);
              setActiveTool("height");
            }}
            onCancel={() => {
              setPendingHeightRolePreview(null);
              setConfirmedHeightPlan(null);
              setManipulationValue(0);
              setHeightPreviewOpen(false);
              setActiveTool("select");
            }}
          />
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
              title: "Height Confidence Annotations",
              value: confidenceAnnotations,
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