"use client";

import dynamic from "next/dynamic";
import {
  buildSizeCandidatePathKeys,
  getObjectDisplayName,
} from "./lib/uncertainty/sizeCandidateSelection";
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
  loadFuzzycadProjectState,
  saveFuzzycadProject,
} from "./lib/onshapeClient";
import type { OperationTool } from "./lib/operations/types";
import OperationToolbar from "./components/OperationToolbar";
import UncertaintyMarksPanel from "./components/UncertaintyMarksPanel";
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
  findSizeAnnotationForPathKey,
  makeSizeAnnotationId,
  type SizeUncertaintyAnnotation,
} from "./lib/uncertainty/document";
import { useUncertaintyDocument } from "./hooks/useUncertaintyDocument";
import { buildFuzzyCADProjectState } from "./lib/fuzzycad/projectState";

const FuzzyCADGeometryViewer = dynamic(
  () => import("./components/FuzzyCADGeometryViewer"),
  {
    ssr: false,
  },
);

type LoadOptions = {
  force?: boolean;
};

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

  const [selectedUncertaintyId, setSelectedUncertaintyId] = useState<
    string | null
  >(null);

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

  const {
    uncertaintyDocument,
    uncertaintyDocumentWithCurrentSource,
    confidenceAnnotations,
    resetUncertaintyDocument,
    upsertSizeMark,
    removeSizeMarks,
    deleteAnnotation,
    replaceUncertaintyDocument,
    updateAnnotationComment,
  } = useUncertaintyDocument(currentUncertaintySource);

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
      Boolean(findSizeAnnotationForPathKey(uncertaintyDocument, pathKey)),
    );
  }, [heightCandidatePathKeys, heightReferencePathKey, uncertaintyDocument]);

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

  function closeSizeUncertaintyEditor() {
    setHeightCandidateOpen(false);
    setHeightCandidatePathKeys([]);
    setHeightConfidenceOpen(false);
  }

  function resetSizeOperationState() {
    setPendingHeightRolePreview(null);
    setConfirmedHeightPlan(null);
    setManipulationValue(0);
    setHeightPreviewOpen(false);
    closeSizeUncertaintyEditor();
  }

  function leaveUncertaintyEditingState() {
    setSelectedUncertaintyId(null);
    closeSizeUncertaintyEditor();
    setActiveTool("select");
  }

  function resetGeometryState() {
    setMeshGraph([]);
    setObjectSummaries([]);
    setSelectedMeshNode(null);
    setHighlightedPathKey(null);
    setLassoPathKeys([]);

    resetSizeOperationState();
    setActiveTool("select");
    setConfidenceDraft(DEFAULT_HEIGHT_CONFIDENCE);
    setConfidenceDirectionDraft(DEFAULT_HEIGHT_DIRECTIONS);
    setSelectedUncertaintyId(null);
    resetUncertaintyDocument();

    setGeometryLoadResult(null);
    resetPlacementTree();

    if (gltfUrl) {
      URL.revokeObjectURL(gltfUrl);
      setGltfUrl(null);
    }
  }

  async function loadAssemblyGeometry(options: LoadOptions = {}) {
    resetGeometryState();

    const res = await fetchOnshapeAssemblyGltf({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      force: options.force,
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

  async function inspectAssemblyGeometryZip(options: LoadOptions = {}) {
    setGeometryZipManifest(null);

    const data = await fetchOnshapeAssemblyZipManifest({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      force: options.force,
    });

    setGeometryZipManifest(data);
  }

  async function loadElements(options: LoadOptions = {}) {
    const data = await fetchOnshapeElements({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      server,
      force: options.force,
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

  async function loadAssemblyDefinition(options: LoadOptions = {}) {
    const data = await fetchOnshapeAssembly({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      force: options.force,
    });

    setAssemblyResult(data);
  }

  async function loadAssemblySummary(options: LoadOptions = {}) {
    const data = await fetchFuzzycadAssemblySummary({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      force: options.force,
    });

    setAssemblySummaryResult(data);
  }

  async function buildRelationshipGraph(options: LoadOptions = {}) {
    const data = await fetchFuzzycadRelationshipGraph({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      force: options.force,
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
      await loadProjectStateFromOnshape();
    } finally {
      setBusy(false);
    }
  }

  function startHeightUncertainty() {
    setActiveTool("height");
    resetSizeOperationState();
    setLassoPathKeys([]);

    if (!selectedObjectSummary) {
      setHeightCandidateOpen(true);
      setHeightCandidatePathKeys([]);
      return;
    }

    const candidates = buildSizeCandidatePathKeys(
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
    const existingAnnotation =
      getExistingConfidenceAnnotation(referencePathKey);

    setHeightCandidateOpen(false);
    setHeightCandidatePathKeys(targetPathKeys);
    setHeightConfidenceOpen(true);

    if (existingAnnotation) {
      setSelectedUncertaintyId(existingAnnotation.id);
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
    const selectedOnlyPathKey =
      heightCandidatePathKeys[0] ?? highlightedPathKey;

    if (!selectedOnlyPathKey) {
      setHeightCandidateOpen(false);
      setHeightConfidenceOpen(false);
      return;
    }

    openHeightConfidenceEditor([selectedOnlyPathKey]);
  }

  function cancelHeightCandidateGroup() {
    closeSizeUncertaintyEditor();
    setActiveTool("select");
  }

  function applyHeightConfidence() {
    const targetPathKeys = getCurrentHeightTargetPathKeys();

    if (targetPathKeys.length === 0) {
      setHeightConfidenceOpen(false);
      return;
    }

    upsertSizeMark({
      pathKeys: targetPathKeys,
      confidence: confidenceDraft,
      directions: confidenceDirectionDraft,
    });

    setSelectedUncertaintyId(makeSizeAnnotationId(targetPathKeys));
    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function removeHeightConfidence() {
    const targetPathKeys = getCurrentHeightTargetPathKeys();

    if (targetPathKeys.length === 0) {
      setHeightConfidenceOpen(false);
      return;
    }

    removeSizeMarks(targetPathKeys);

    setSelectedUncertaintyId(null);
    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function selectUncertaintyCard(annotationId: string | null) {
    setSelectedUncertaintyId(annotationId);

    if (!annotationId) {
      leaveUncertaintyEditingState();
      return;
    }

    const annotation =
      uncertaintyDocumentWithCurrentSource.annotations.find(
        (item) => item.id === annotationId,
      ) ?? null;

    if (!annotation) {
      return;
    }

    if (annotation.type === "size") {
      setActiveTool("height");
      resetSizeOperationState();
      setLassoPathKeys([]);

      openHeightConfidenceEditor(annotation.target.pathKeys);
    }
  }

  function editSizeUncertaintyCard(annotation: SizeUncertaintyAnnotation) {
    setActiveTool("height");
    resetSizeOperationState();
    setLassoPathKeys([]);
    setSelectedUncertaintyId(annotation.id);

    openHeightConfidenceEditor(annotation.target.pathKeys);
  }

  function deleteUncertaintyCard(annotationId: string) {
    deleteAnnotation(annotationId);

    setSelectedUncertaintyId((previous) =>
      previous === annotationId ? null : previous,
    );
  }

  function updateUncertaintyCardComment(annotationId: string, comment: string) {
    updateAnnotationComment(annotationId, comment);
  }

async function saveProjectStateToOnshape() {
  if (!documentId || !workspaceId) {
    console.warn("Missing documentId or workspaceId");
    return;
  }

  const projectState = buildFuzzyCADProjectState({
    source: currentUncertaintySource,
    annotations: uncertaintyDocumentWithCurrentSource.annotations,
    objectSummaries,
  });

  const result = await saveFuzzycadProject(
    {
      documentId,
      workspaceId,
      server,
    },
    projectState,
  );

  console.log("Saved FuzzyCAD project:", result);
}

  async function loadProjectStateFromOnshape(options: LoadOptions = {}) {
    if (!documentId || !workspaceId) {
      console.warn("Missing documentId or workspaceId");
      return;
    }

    const result = await loadFuzzycadProjectState({
      documentId,
      workspaceId,
      server,
      force: options.force,
    });

    console.log("Loaded FuzzyCAD project state:", result);

    if (result.ok && result.state) {
      replaceUncertaintyDocument(result.state as typeof uncertaintyDocument);
    }
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

  function handleViewerSelectedPathKey(pathKey: string | null) {
    setHighlightedPathKey(pathKey);
    leaveUncertaintyEditingState();
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
          onSelectedPathKey={handleViewerSelectedPathKey}
          onObjectLassoSelection={(pathKeys) => {
            setLassoPathKeys(pathKeys);
            setHighlightedPathKey(pathKeys[0] ?? null);
            leaveUncertaintyEditingState();
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
            resetSizeOperationState();

            if (tool === "select") {
              setLassoPathKeys([]);
            }
          }}
        />

        <UncertaintyMarksPanel
          document={uncertaintyDocumentWithCurrentSource}
          selectedAnnotationId={selectedUncertaintyId}
          onSelectAnnotation={selectUncertaintyCard}
          onEditSizeAnnotation={editSizeUncertaintyCard}
          onDeleteAnnotation={deleteUncertaintyCard}
          onCommentChange={updateUncertaintyCardComment}
          onSaveToOnshape={() => void saveProjectStateToOnshape()}
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
              heightCandidatePathKeys.length > 1
                ? "Include related"
                : "Continue"
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
