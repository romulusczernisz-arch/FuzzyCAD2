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
  DEFAULT_HEIGHT_DIRECTIONS,
  type AxisConfidenceMap,
  type AxisDirectionMap,
  type ConfidenceAxis,
  type ConfidenceDirection,
  type ConfidenceLevel,
} from "./lib/uncertainty/types";
import {
  createEmptyUncertaintyDocument,
  findSizeAnnotationForPathKey,
  removeSizeAnnotationsForPathKeys,
  toFuzzyConfidenceAnnotations,
  upsertSizeAnnotation,
} from "./lib/uncertainty/document";

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

function normalizeSemanticObjectName(name: string | null) {
  if (!name) {
    return "";
  }

  return (
    name
      .toLowerCase()

      // Remove Onshape / imported instance suffixes.
      // LowerLeg_1 -> lowerleg
      // LowerLeg_2 -> lowerleg
      // LowerLeg (3) -> lowerleg
      .replace(/\s*\(\d+\)\s*$/g, "")
      .replace(/[_\-\s]*\d+\s*$/g, "")

      // Normalize separators.
      .replace(/[_\-\s]+/g, "")

      .trim()
  );
}

function getSizeSimilarity(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  const sourceSize = source.aabbSizeWorld;
  const targetSize = target.aabbSizeWorld;

  const ratios = sourceSize.map((sourceValue, index) => {
    const targetValue = targetSize[index];

    const minValue = Math.min(sourceValue, targetValue);
    const maxValue = Math.max(sourceValue, targetValue);

    if (maxValue < 1e-6) {
      return 1;
    }

    return minValue / maxValue;
  });

  return Math.min(...ratios);
}

function getAxisSimilarity(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  const sourceAxis = source.principalAxisWorld;
  const targetAxis = target.principalAxisWorld;

  return Math.abs(
    sourceAxis[0] * targetAxis[0] +
      sourceAxis[1] * targetAxis[1] +
      sourceAxis[2] * targetAxis[2],
  );
}

function isStrictGeometryMatch(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  if (source.pathKey === target.pathKey) {
    return false;
  }

  const sizeSimilarity = getSizeSimilarity(source, target);
  const axisSimilarity = getAxisSimilarity(source, target);

  const lengthRatio =
    Math.min(source.axisLength, target.axisLength) /
    Math.max(source.axisLength, target.axisLength);

  const thicknessRatio =
    Math.min(source.crossSectionSize, target.crossSectionSize) /
    Math.max(source.crossSectionSize, target.crossSectionSize);

  return (
    // Both objects should be elongated objects, not blocks/caps/clamps.
    source.elongationRatio > 2.3 &&
    target.elongationRatio > 2.3 &&
    // Bounding box dimensions should be close.
    sizeSimilarity > 0.78 &&
    // Principal directions should be close.
    axisSimilarity > 0.86 &&
    // Length and thickness should both be close.
    lengthRatio > 0.78 &&
    thicknessRatio > 0.7
  );
}

function buildHeightCandidatePathKeys(
  selectedSummary: AxialStretchObjectSummary,
  objectSummaries: AxialStretchObjectSummary[],
) {
  const selectedSemanticName = normalizeSemanticObjectName(
    selectedSummary.name,
  );

  const semanticMatches = objectSummaries.filter((summary) => {
    if (summary.pathKey === selectedSummary.pathKey) {
      return false;
    }

    if (!selectedSemanticName) {
      return false;
    }

    return normalizeSemanticObjectName(summary.name) === selectedSemanticName;
  });

  // Important:
  // If semantic matches exist, trust them first.
  // This prevents geometry matching from pulling in clamps, pivots, caps, etc.
  if (semanticMatches.length > 0) {
    return [
      selectedSummary.pathKey,
      ...semanticMatches.map((summary) => summary.pathKey),
    ];
  }

  // Geometry fallback only happens when naming does not give us related objects.
  const geometryMatches = objectSummaries.filter((summary) =>
    isStrictGeometryMatch(selectedSummary, summary),
  );

  return [
    selectedSummary.pathKey,
    ...geometryMatches.map((summary) => summary.pathKey),
  ];
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
  const [confidenceDirectionDraft, setConfidenceDirectionDraft] =
    useState<AxisDirectionMap>(DEFAULT_HEIGHT_DIRECTIONS);

  const [uncertaintyDocument, setUncertaintyDocument] = useState(() =>
    createEmptyUncertaintyDocument({
      documentId: params.get("documentId"),
      workspaceId: params.get("workspaceId"),
      elementId: params.get("elementId"),
      assemblyElementId: selectedAssemblyId || null,
      server: params.get("server") || "https://cad.onshape.com",
    }),
  );

  const confidenceAnnotations = useMemo(
    () => toFuzzyConfidenceAnnotations(uncertaintyDocument),
    [uncertaintyDocument],
  );

  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");
  const server = params.get("server") || "https://cad.onshape.com";
  const oauthStatus = params.get("oauth");

  const currentUncertaintySource = useMemo(
  () => ({
    documentId,
    workspaceId,
    elementId,
    assemblyElementId: selectedAssemblyId || null,
    server,
  }),
  [documentId, workspaceId, elementId, selectedAssemblyId, server],
);

const uncertaintyDocumentWithCurrentSource = useMemo(
  () => ({
    ...uncertaintyDocument,
    source: currentUncertaintySource,
  }),
  [uncertaintyDocument, currentUncertaintySource],
); 

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
      objectSummaries.find(
        (summary) => summary.pathKey === highlightedPathKey,
      ) ?? null
    );
  }, [highlightedPathKey, objectSummaries]);

  const heightCandidateSummaries = useMemo(() => {
    return heightCandidatePathKeys
      .map((pathKey) =>
        objectSummaries.find((summary) => summary.pathKey === pathKey),
      )
      .filter(
        (summary): summary is AxialStretchObjectSummary =>
          summary !== undefined,
      );
  }, [heightCandidatePathKeys, objectSummaries]);

  const heightReferencePathKey =
    heightCandidatePathKeys[0] ?? highlightedPathKey ?? null;

    

     const heightEditorCanRemove = useMemo(() => {
    const targetPathKeys =
      heightCandidatePathKeys.length > 0
        ? heightCandidatePathKeys
        : heightReferencePathKey
          ? [heightReferencePathKey]
          : [];

    return targetPathKeys.some((pathKey) =>
      confidenceAnnotations.some((annotation) => annotation.pathKey === pathKey),
    );
  }, [heightCandidatePathKeys, heightReferencePathKey, confidenceAnnotations]);

  const viewerSelectedPathKeys = useMemo(() => {
    if (
      (heightCandidateOpen || heightConfidenceOpen) &&
      heightCandidatePathKeys.length > 0
    ) {
      return heightCandidatePathKeys;
    }

    return lassoPathKeys;
  }, [
    heightCandidateOpen,
    heightConfidenceOpen,
    heightCandidatePathKeys,
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
    setConfidenceDirectionDraft(DEFAULT_HEIGHT_DIRECTIONS);
setUncertaintyDocument(
  createEmptyUncertaintyDocument(currentUncertaintySource),
);
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

  if (candidates.length <= 1) {
    openHeightConfidenceEditor(candidates);
    return;
  }

  setHeightCandidateOpen(true);
}

  function getExistingConfidenceAnnotation(pathKey: string | null) {
    return findSizeAnnotationForPathKey(uncertaintyDocument, pathKey);
  }

  function getCurrentHeightTargetPathKeys() {
    return heightCandidatePathKeys.length > 0
      ? heightCandidatePathKeys
      : heightReferencePathKey
        ? [heightReferencePathKey]
        : [];
  }

  function openHeightConfidenceEditor(targetPathKeys: string[]) {
  const referencePathKey = targetPathKeys[0] ?? null;
  const existingAnnotation = getExistingConfidenceAnnotation(referencePathKey);

  setHeightCandidateOpen(false);
  setHeightCandidatePathKeys(targetPathKeys);
  setHeightConfidenceOpen(true);

  if (existingAnnotation) {
    setConfidenceDraft({ ...existingAnnotation.confidence });
    setConfidenceDirectionDraft({
      ...DEFAULT_HEIGHT_DIRECTIONS,
      ...(existingAnnotation.directions ?? {}),
    });
    return;
  }

  setConfidenceDraft(DEFAULT_HEIGHT_CONFIDENCE);
  setConfidenceDirectionDraft(DEFAULT_HEIGHT_DIRECTIONS);
}

function confirmHeightCandidateGroup() {
  if (heightCandidatePathKeys.length === 0) {
    setHeightCandidateOpen(false);
    setHeightConfidenceOpen(false);
    return;
  }

  openHeightConfidenceEditor(heightCandidatePathKeys);
}

function confirmSelectedOnlyHeightCandidate() {
  const selectedOnlyPathKey = heightCandidatePathKeys[0] ?? highlightedPathKey;

  if (!selectedOnlyPathKey) {
    setHeightCandidateOpen(false);
    setHeightConfidenceOpen(false);
    return;
  }

  openHeightConfidenceEditor([selectedOnlyPathKey]);
}

  function cancelHeightCandidateGroup() {
    setHeightCandidateOpen(false);
    setHeightCandidatePathKeys([]);
    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function applyHeightConfidence() {
    const targetPathKeys = getCurrentHeightTargetPathKeys();

    if (targetPathKeys.length === 0) {
      setHeightConfidenceOpen(false);
      return;
    }

setUncertaintyDocument((previous) =>
  upsertSizeAnnotation(
    {
      ...previous,
      source: currentUncertaintySource,
    },
    {
      pathKeys: targetPathKeys,
      confidence: confidenceDraft,
      directions: confidenceDirectionDraft,
    },
  ),
);

    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function removeHeightConfidence() {
    const targetPathKeys = getCurrentHeightTargetPathKeys();

    if (targetPathKeys.length === 0) {
      setHeightConfidenceOpen(false);
      return;
    }

setUncertaintyDocument((previous) =>
  removeSizeAnnotationsForPathKeys(
    {
      ...previous,
      source: currentUncertaintySource,
    },
    targetPathKeys,
  ),
);

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

  function updateConfidenceDirectionDraft(
    axis: ConfidenceAxis,
    direction: ConfidenceDirection,
  ) {
    setConfidenceDirectionDraft((previous) => ({
      ...previous,
      [axis]: direction,
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
          enableManipulationHandles={
            !heightPreviewOpen && Boolean(confirmedHeightPlan)
          }
          manipulationValue={manipulationValue}
          confidenceAnnotations={confidenceAnnotations}
          confidenceEditor={
            heightConfidenceOpen && heightReferencePathKey
              ? {
                  pathKey: heightReferencePathKey,
                  confidence: confidenceDraft,
                  directions: confidenceDirectionDraft,
                  onConfidenceChange: updateConfidenceDraft,
                  onDirectionChange: updateConfidenceDirectionDraft,
                  canRemove: heightEditorCanRemove,
                  onRemove: removeHeightConfidence,
                  onApply: applyHeightConfidence,
                  onCancel: () => {
                    setHeightConfidenceOpen(false);
                    setActiveTool("select");
                  },
                }
              : null
          }
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
        ? "Related objects found"
        : "Select one object first"
    }
    description={
      heightCandidatePathKeys.length > 1
        ? `FuzzyCAD found ${
            heightCandidatePathKeys.length - 1 === 1
              ? "one related object"
              : `${heightCandidatePathKeys.length - 1} related objects`
          }. You can annotate only the selected object, or apply the same size uncertainty annotation to the related objects as a group.`
        : heightCandidatePathKeys.length === 1
          ? "FuzzyCAD did not find other similar objects. You can still annotate the selected object."
          : "Click one object in the viewer, then click Size."
    }
    suggestedObjects={
      heightCandidatePathKeys.length > 1
        ? heightCandidateSummaries.map(getObjectDisplayName)
        : undefined
    }
    confirmLabel={
      heightCandidatePathKeys.length > 1 ? "Include related" : "Continue"
    }
    secondaryConfirmLabel={
      heightCandidatePathKeys.length > 1 ? "Selected only" : undefined
    }
    cancelLabel="Cancel"
    onConfirm={
      heightCandidatePathKeys.length > 1
        ? confirmHeightCandidateGroup
        : confirmSelectedOnlyHeightCandidate
    }
    onSecondaryConfirm={
      heightCandidatePathKeys.length > 1
        ? confirmSelectedOnlyHeightCandidate
        : undefined
    }
    onCancel={cancelHeightCandidateGroup}
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
  title: "Uncertainty Document",
  value: uncertaintyDocumentWithCurrentSource,
},
            {
              title: "Derived Size Visual Annotations",
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
