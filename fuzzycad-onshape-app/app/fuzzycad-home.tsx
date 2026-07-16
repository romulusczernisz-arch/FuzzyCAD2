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
  clearAssemblySessionCache,
  fetchFuzzycadAssemblyData,
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
import { exportAnnotatedSelectionStl } from "./lib/fuzzycad/exportAnnotatedSelectionStl";
import {
  findMateConnectedParts,
  type MateGraphEdge,
} from "./lib/fuzzycad/mateGraph";

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



/**
 * Convert a vector/point from Three.js viewer world space to Onshape assembly
 * space by undoing the viewer's scene.rotation.x = -π/2 display rotation:
 * viewer (x, y, z) → onshape (x, -z, y).
 */
function viewerToOnshape(
  v?: [number, number, number],
): [number, number, number] | undefined {
  if (!v) return undefined;
  return [v[0], -v[2], v[1]];
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

  const [pendingAngle, setPendingAngle] = useState<{
    part1PathKey: string;
    part2PathKey: string;
    /** Target angle (deg) the user is editing toward. */
    angleDeg: number;
    /** Angle between the two selected face normals as clicked (deg). */
    measuredAngleDeg?: number;
    /** Face normals in viewer world space (scene.rotation.x = -π/2 applied). */
    face1NormalViewer?: [number, number, number];
    face2NormalViewer?: [number, number, number];
    /** Snapped pivot vertex in viewer world space. */
    pivotViewer?: [number, number, number];
  } | null>(null);
  const [pendingAngleComment, setPendingAngleComment] = useState("");
  /** Similar-part candidates for part2 when the angle popup is open. */
  const [angleCandidateOpen, setAngleCandidateOpen] = useState(false);
  /** [part2PathKey, ...similar part2 pathKeys] */
  const [angleCandidatePart2Keys, setAngleCandidatePart2Keys] = useState<string[]>([]);
  /** Incremented to tell the viewer to clear its angle/bend selection + preview. */
  const [angleResetNonce, setAngleResetNonce] = useState(0);

  const [pendingBend, setPendingBend] = useState<{
    pathKey: string;
    deltaDeg: number;
    /** Crease + plane in viewer world space (converted on save). */
    creaseStartViewer: [number, number, number];
    creaseEndViewer: [number, number, number];
    planeNormalViewer: [number, number, number];
    bendSideSign: 1 | -1;
  } | null>(null);
  const [pendingBendComment, setPendingBendComment] = useState("");

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
    saveAngleMark,
    saveBendMark,
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

  /**
   * Fetch both the relationship graph and assembly summary in a single request,
   * saving one Onshape API call on cache-miss and one HTTP round-trip.
   * The combined ApiResult has both `graph` and `summary` fields populated.
   */
  async function loadAssemblyData(options: LoadOptions = {}) {
    const data = await fetchFuzzycadAssemblyData({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      force: options.force,
    });

    // Both hooks (usePartGraph, useAssemblyPlacementTree) read `result.graph`
    // from ApiResult. The combined response sets `graph` at the top level.
    setRelationshipGraphResult(data);
    // Dev panel shows this as a debug value; summary is at `data.summary`.
    setAssemblySummaryResult(data);
  }

  async function loadSelectedAssembly() {
    if (!selectedAssemblyId) {
      return;
    }

    setBusy(true);

    try {
      // Combined endpoint fetches assembly once and returns graph + summary.
      // Geometry load is run in parallel with the combined call.
      await Promise.all([
        loadAssemblyData(),
        loadAssemblyGeometry(),
      ]);
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

  /** Mate edges from the relationship graph (already fetched — no extra API calls). */
  const mateEdges = useMemo<MateGraphEdge[]>(() => {
    const data = relationshipGraphResult?.data as
      | Record<string, unknown>
      | undefined;
    return Array.isArray(data?.mateEdges)
      ? (data.mateEdges as MateGraphEdge[])
      : [];
  }, [relationshipGraphResult]);

  /** Clear pending-angle UI state and tell the viewer to reset its selection + preview. */
  function finishPendingAngle() {
    setPendingAngle(null);
    setPendingAngleComment("");
    setAngleCandidateOpen(false);
    setAngleCandidatePart2Keys([]);
    setAngleResetNonce((nonce) => nonce + 1);
  }

  /**
   * Save the pending angle mark for each given part2 pathKey (one annotation
   * per instance for "apply to all"), then reset the angle tool.
   */
  function commitPendingAngle(part2PathKeys: string[]) {
    if (!pendingAngle) return;

    for (const part2PathKey of part2PathKeys) {
      const related = findMateConnectedParts(
        part2PathKey,
        pendingAngle.part1PathKey,
        mateEdges,
      );

      const pivotPoint = viewerToOnshape(pendingAngle.pivotViewer);

      saveAngleMark({
        part1PathKey: pendingAngle.part1PathKey,
        part2PathKey,
        relatedPart2PathKeys: related.length > 0 ? related : undefined,
        angleDeg: pendingAngle.angleDeg,
        face1Normal: viewerToOnshape(pendingAngle.face1NormalViewer),
        face2Normal: viewerToOnshape(pendingAngle.face2NormalViewer),
        pivotPoint,
        pivot: pivotPoint ? { kind: "vertex", point: pivotPoint } : undefined,
        comment: pendingAngleComment || undefined,
      });
    }

    finishPendingAngle();
    setActiveTool("select");
  }

  /** Clear pending-bend UI state and reset the viewer's bend selection + preview. */
  function finishPendingBend() {
    setPendingBend(null);
    setPendingBendComment("");
    setAngleResetNonce((nonce) => nonce + 1);
  }

  function commitPendingBend() {
    if (!pendingBend) return;

    const creaseStart = viewerToOnshape(pendingBend.creaseStartViewer);
    const creaseEnd = viewerToOnshape(pendingBend.creaseEndViewer);
    const planeNormal = viewerToOnshape(pendingBend.planeNormalViewer);

    if (!creaseStart || !creaseEnd || !planeNormal) return;

    saveBendMark({
      pathKey: pendingBend.pathKey,
      deltaDeg: pendingBend.deltaDeg,
      creaseStart,
      creaseEnd,
      planeNormal,
      bendSideSign: pendingBend.bendSideSign,
      comment: pendingBendComment || undefined,
    });

    finishPendingBend();
    setActiveTool("select");
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

  const annotatedSelectionStl =
    gltfUrl && placements
      ? await exportAnnotatedSelectionStl({
          gltfUrl,
          placements,
          annotations: uncertaintyDocumentWithCurrentSource.annotations,
        })
      : null;

  const angleAnnotationCount =
    uncertaintyDocumentWithCurrentSource.annotations.filter(
      (annotation) => annotation.type === "angle",
    ).length;
  const bendAnnotationCount =
    uncertaintyDocumentWithCurrentSource.annotations.filter(
      (annotation) => annotation.type === "bend",
    ).length;

  console.log(
    `[FuzzyCAD] Save to Onshape: ${uncertaintyDocumentWithCurrentSource.annotations.length} annotation(s) (${angleAnnotationCount} angle, ${bendAnnotationCount} bend). STL: ${
      annotatedSelectionStl ? `${annotatedSelectionStl.size} bytes` : "none generated"
    }`,
  );

  const result = await saveFuzzycadProject(
    {
      documentId,
      workspaceId,
      server,
    },
    projectState,
    {
      annotatedSelectionStl,
    },
  );

  console.log("Saved FuzzyCAD project:", result);

  // Focused log for the suppress-originals step so failures are easy to spot.
  const resultRecord =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : null;
  if (resultRecord && "hideAngleOriginalsResult" in resultRecord) {
    console.log(
      "[FuzzyCAD] Suppress originals result:",
      resultRecord.hideAngleOriginalsResult,
    );
  }
}


function normalizeLoadedUncertaintyDocument(state: unknown) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const record = state as {
    annotations?: unknown;
  };

  if (!Array.isArray(record.annotations)) {
    return null;
  }

  return {
    version: "0.1" as const,
    source: currentUncertaintySource,
    annotations: record.annotations,
  };
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
  const loadedDocument = normalizeLoadedUncertaintyDocument(result.state);

  if (loadedDocument) {
    replaceUncertaintyDocument(loadedDocument);
  }
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
    // Clear the previous assembly's client-side session cache before switching
    if (selectedAssemblyId && documentId && workspaceId) {
      clearAssemblySessionCache({
        documentId,
        workspaceId,
        assemblyElementId: selectedAssemblyId,
        server,
      });
    }
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
          angleTargetDeg={
            activeTool === "angle" ? pendingAngle?.angleDeg ?? null : null
          }
          angleMateEdges={mateEdges}
          angleResetNonce={angleResetNonce}
          onAngleSelection={({
            part1PathKey,
            part2PathKey,
            angleDeg,
            measuredAngleDeg,
            face1Normal,
            face2Normal,
            pivot,
          }) => {
            // Fires when the vertex + two-face selection completes, and again
            // on every arc-handle drag. Just keep pendingAngle in sync — the
            // "apply to similar parts" check happens at save time instead.
            setPendingAngle((previous) => {
              const next = {
                part1PathKey,
                part2PathKey,
                angleDeg,
                measuredAngleDeg,
                face1NormalViewer: face1Normal,
                face2NormalViewer: face2Normal,
                pivotViewer: pivot,
              };

              const samePivot =
                previous?.pivotViewer && pivot
                  ? previous.pivotViewer.every(
                      (value, index) => Math.abs(value - pivot[index]) < 1e-9,
                    )
                  : previous?.pivotViewer === pivot;

              if (
                previous &&
                previous.part1PathKey === part1PathKey &&
                previous.part2PathKey === part2PathKey &&
                samePivot &&
                Math.abs(previous.angleDeg - angleDeg) < 1e-4
              ) {
                return previous;
              }

              return next;
            });
          }}
          bendDeltaDeg={
            activeTool === "bend" ? pendingBend?.deltaDeg ?? null : null
          }
          onBendSelection={({
            pathKey,
            deltaDeg,
            creaseStart,
            creaseEnd,
            planeNormal,
            bendSideSign,
          }) => {
            setPendingBend((previous) => {
              if (
                previous &&
                previous.pathKey === pathKey &&
                previous.bendSideSign === bendSideSign &&
                Math.abs(previous.deltaDeg - deltaDeg) < 1e-4 &&
                previous.creaseStartViewer.every(
                  (value, index) => Math.abs(value - creaseStart[index]) < 1e-9,
                ) &&
                previous.creaseEndViewer.every(
                  (value, index) => Math.abs(value - creaseEnd[index]) < 1e-9,
                )
              ) {
                return previous;
              }

              return {
                pathKey,
                deltaDeg,
                creaseStartViewer: creaseStart,
                creaseEndViewer: creaseEnd,
                planeNormalViewer: planeNormal,
                bendSideSign,
              };
            });
          }}
        />

        <OperationToolbar
          activeTool={activeTool}
          disabled={!gltfUrl}
          onToolChange={(tool) => {
            if (tool === "height") {
              startHeightUncertainty();
              setPendingAngle(null);
              setPendingAngleComment("");
              setPendingBend(null);
              setPendingBendComment("");
              return;
            }

            if (tool !== "angle") {
              setPendingAngle(null);
              setPendingAngleComment("");
            }

            if (tool !== "bend") {
              setPendingBend(null);
              setPendingBendComment("");
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
          pendingAngle={activeTool === "angle" ? pendingAngle : null}
          pendingAngleComment={pendingAngleComment}
          onPendingAngleCommentChange={setPendingAngleComment}
          onSaveAngle={() => {
            if (!pendingAngle) return;

            // Check for similar instances of part2 to offer "apply to all".
            // This happens at save time so the user can adjust the angle and
            // comment first.
            const part2Summary = objectSummaries.find(
              (summary) => summary.pathKey === pendingAngle.part2PathKey,
            );
            const candidates = part2Summary
              ? buildSizeCandidatePathKeys(part2Summary, objectSummaries)
              : [pendingAngle.part2PathKey];

            if (candidates.length > 1) {
              setAngleCandidatePart2Keys(candidates);
              setAngleCandidateOpen(true);
              return;
            }

            commitPendingAngle([pendingAngle.part2PathKey]);
          }}
          onCancelAngle={finishPendingAngle}
          pendingBend={activeTool === "bend" ? pendingBend : null}
          pendingBendComment={pendingBendComment}
          onPendingBendCommentChange={setPendingBendComment}
          onPendingBendValueChange={(deltaDeg) => {
            if (pendingBend) {
              setPendingBend({ ...pendingBend, deltaDeg });
            }
          }}
          onSaveBend={commitPendingBend}
          onCancelBend={finishPendingBend}
          onPendingAngleValueChange={(deg) => {
            if (pendingAngle) {
              setPendingAngle({ ...pendingAngle, angleDeg: deg });
            }
          }}
        />

        {angleCandidateOpen && pendingAngle ? (
          <OperationPreviewPanel
            operation="height"
            title="Modify related components?"
            description={
              angleCandidatePart2Keys.length > 1
                ? `${
                    angleCandidatePart2Keys.length - 1 === 1
                      ? "1 similar component was"
                      : `${angleCandidatePart2Keys.length - 1} similar components were`
                  } found. Apply this angle annotation to all of them, or just the selected one.`
                : "No similar components found. Continuing will annotate only the selected part."
            }
            suggestedObjects={
              angleCandidatePart2Keys.length > 1
                ? angleCandidatePart2Keys
                    .map((pk) => objectSummaries.find((s) => s.pathKey === pk))
                    .filter(Boolean)
                    .map((s) => getObjectDisplayName(s!))
                : undefined
            }
            confirmLabel={angleCandidatePart2Keys.length > 1 ? "Apply to all" : "Continue"}
            secondaryConfirmLabel={angleCandidatePart2Keys.length > 1 ? "Selected only" : undefined}
            cancelLabel="Cancel"
            onConfirm={() => {
              // "Apply to all": save one annotation per similar part2 instance
              commitPendingAngle(angleCandidatePart2Keys);
            }}
            onSecondaryConfirm={
              angleCandidatePart2Keys.length > 1
                ? () => {
                    // "Selected only": annotate just the originally-clicked part2
                    commitPendingAngle([pendingAngle.part2PathKey]);
                  }
                : undefined
            }
            onCancel={() => {
              // Back to editing — keep the pending mark and viewer preview.
              setAngleCandidateOpen(false);
              setAngleCandidatePart2Keys([]);
            }}
          />
        ) : null}

        {heightCandidateOpen ? (
          <OperationPreviewPanel
            operation="height"
            title={
              heightCandidatePathKeys.length > 0
                ? "Modify related components?"
                : "Select one object first"
            }
            description={
              heightCandidatePathKeys.length > 1
                ? `${
                    heightCandidatePathKeys.length - 1 === 1
                      ? "1 similar component was"
                      : `${heightCandidatePathKeys.length - 1} similar components were`
                  } found. Apply this annotation to all of them, or just the selected one.`
                : heightCandidatePathKeys.length === 1
                  ? "No similar components found. Continuing will annotate only the selected object."
                  : "Click one object in the viewer, then click Size."
            }
            suggestedObjects={
              heightCandidatePathKeys.length > 1
                ? heightCandidateSummaries.map(getObjectDisplayName)
                : undefined
            }
            confirmLabel={
              heightCandidatePathKeys.length > 1
                ? "Apply to all"
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
