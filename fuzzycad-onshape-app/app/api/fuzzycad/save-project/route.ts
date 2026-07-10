import { NextRequest, NextResponse } from "next/server";
import {
  clearElementsCache,
  getCachedElements,
} from "../../../lib/server/onshapeElementsCache";
import {
  clearAssemblyCache,
  getCachedAssembly,
} from "../../../lib/server/onshapeAssemblyCache";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

const PROJECT_STATE_FILENAME = "fuzzycad-project-state.json";
const GENERATED_GEOMETRY_FILENAME = "fuzzycad-generated-geometry.json";
const ANNOTATED_SELECTION_STL_FILENAME = "fuzzycad-annotated-selection.stl";
const VISUALIZATION_LAYER_NAME = "FuzzyCAD_Visualization_Layer";
const ASSEMBLY_OVERLAY_INSTANCE_NAME = "FuzzyCAD_Generated_Overlay";

type UnknownRecord = Record<string, unknown>;

type SaveProjectRequestBody = {
  documentId: string;
  workspaceId: string;
  server?: string;
  projectState: UnknownRecord;
};

type UpsertBlobResult = {
  ok: boolean;
  status: number;
  mode: "created-container" | "updated-existing-container";
  filename: string;
  elementId: string | null;
  endpoint: string;
  data: unknown;
};

type ParsedSaveProjectRequest = {
  body: SaveProjectRequestBody;
  annotatedSelectionStl: Blob | null;
};

function getStringFormField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function parseSaveProjectRequest(
  req: NextRequest,
): Promise<ParsedSaveProjectRequest> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();

    const projectStateRaw = getStringFormField(formData, "projectState");
    const parsedProjectState = JSON.parse(projectStateRaw) as unknown;

    if (!isRecord(parsedProjectState)) {
      throw new Error("Invalid projectState payload.");
    }

    const stlValue = formData.get("annotatedSelectionStl");
    const annotatedSelectionStl =
      stlValue instanceof Blob && stlValue.size > 0 ? stlValue : null;

    return {
      body: {
        documentId: getStringFormField(formData, "documentId"),
        workspaceId: getStringFormField(formData, "workspaceId"),
        server: getStringFormField(formData, "server") || undefined,
        projectState: parsedProjectState,
      },
      annotatedSelectionStl,
    };
  }

  const body = (await req.json()) as SaveProjectRequestBody;

  return {
    body,
    annotatedSelectionStl: null,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getElementName(element: UnknownRecord) {
  const name = element.name;
  return typeof name === "string" ? name : "";
}

function getElementId(element: UnknownRecord) {
  const id = element.id;
  return typeof id === "string" ? id : null;
}

function findLatestElementByName(elements: unknown, name: string) {
  if (!Array.isArray(elements)) {
    return null;
  }

  const matched = elements
    .filter(isRecord)
    .filter((element) => getElementName(element) === name);

  const latest = matched[matched.length - 1];

  if (!latest) {
    return null;
  }

  const id = getElementId(latest);

  if (!id) {
    return null;
  }

  return {
    id,
    element: latest,
  };
}

function getElementIdFromResponse(data: unknown) {
  if (!isRecord(data)) {
    return null;
  }

  const directId = data.id;
  if (typeof directId === "string") {
    return directId;
  }

  const elementId = data.elementId;
  if (typeof elementId === "string") {
    return elementId;
  }

  const href = data.href;
  if (typeof href === "string") {
    const match = href.match(/\/e\/([^/?]+)/);
    return match?.[1] ?? null;
  }

  return null;
}

async function upsertBlobContainer(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  filename: string;
  blobData: Blob;
  elements: unknown;
  route: string;
  createOperation: string;
  updateOperation: string;
}): Promise<UpsertBlobResult> {
  const existingElement = findLatestElementByName(
    input.elements,
    input.filename,
  );

  const formData = new FormData();

  formData.append("file", input.blobData, input.filename);
  formData.append("encodedFilename", input.filename);

  const endpoint = existingElement
    ? `${input.server}/api/blobelements/d/${input.documentId}/w/${input.workspaceId}/e/${existingElement.id}`
    : `${input.server}/api/blobelements/d/${input.documentId}/w/${input.workspaceId}`;

  const operation = existingElement
    ? input.updateOperation
    : input.createOperation;

  const onshapeRes = await onshapeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
      },
      body: formData,
    },
    {
      route: input.route,
      operation,
    },
  );

  const data = await parseJsonOrText(onshapeRes);

  return {
    ok: onshapeRes.ok,
    status: onshapeRes.status,
    mode: existingElement ? "updated-existing-container" : "created-container",
    filename: input.filename,
    elementId: existingElement?.id ?? getElementIdFromResponse(data),
    endpoint,
    data,
  };
}

async function upsertJsonBlobContainer(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  filename: string;
  jsonData: unknown;
  elements: unknown;
  route: string;
  createOperation: string;
  updateOperation: string;
}): Promise<UpsertBlobResult> {
  const json = JSON.stringify(input.jsonData, null, 2);

  return upsertBlobContainer({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    accessToken: input.accessToken,
    filename: input.filename,
    blobData: new Blob([json], { type: "application/json" }),
    elements: input.elements,
    route: input.route,
    createOperation: input.createOperation,
    updateOperation: input.updateOperation,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStringFromRecord(record: UnknownRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getTranslationHref(data: unknown) {
  if (!isRecord(data)) return null;

  const href = getStringFromRecord(data, "href");
  if (href) return href;

  const requestState = data.requestState;
  if (isRecord(requestState)) {
    const requestHref = getStringFromRecord(requestState, "href");
    if (requestHref) return requestHref;
  }

  return null;
}

function getTranslationState(data: unknown) {
  if (!isRecord(data)) return null;

  const requestState = data.requestState;

  if (typeof requestState === "string") {
    return requestState;
  }

  if (isRecord(requestState)) {
    return (
      getStringFromRecord(requestState, "state") ??
      getStringFromRecord(requestState, "status")
    );
  }

  return (
    getStringFromRecord(data, "state") ?? getStringFromRecord(data, "status")
  );
}

function getFirstStringFromArrayField(data: unknown, key: string) {
  if (!isRecord(data)) return null;

  const value = data[key];

  if (!Array.isArray(value)) return null;

  const first = value.find((item) => typeof item === "string");

  return typeof first === "string" ? first : null;
}

function getTranslatedElementId(
  data: unknown,
  sourceElementId?: string | null,
) {
  if (!isRecord(data)) return null;

  /**
   * Important:
   * Prefer result fields first.
   *
   * For upload/translation responses, top-level elementId can point to a Blob
   * element, not a generated Part Studio. If we use that as visualizationElementId,
   * /api/parts/... will fail with "Element type BLOB is not a part studio."
   */
  const arrayCandidate =
    getFirstStringFromArrayField(data, "resultElementIds") ??
    getFirstStringFromArrayField(data, "createdElementIds") ??
    getFirstStringFromArrayField(data, "elementIds");

  if (arrayCandidate && arrayCandidate !== sourceElementId) {
    return arrayCandidate;
  }

  const directCandidate =
    getStringFromRecord(data, "resultElementId") ??
    getStringFromRecord(data, "createdElementId") ??
    getStringFromRecord(data, "newElementId") ??
    getStringFromRecord(data, "translatedElementId");

  if (directCandidate && directCandidate !== sourceElementId) {
    return directCandidate;
  }

  /**
   * Last resort only. This is often a Blob element id.
   */
  const fallbackElementId =
    getStringFromRecord(data, "elementId") ??
    getStringFromRecord(data, "elementIdOrMicroversionId");

  if (fallbackElementId && fallbackElementId !== sourceElementId) {
    return fallbackElementId;
  }

  return null;
}

function getVisualizationElementIdFromResult(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const visualizationElementId = value.visualizationElementId;

  return typeof visualizationElementId === "string"
    ? visualizationElementId
    : null;
}

function getVisualizationElementIdFromAttempt(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const visualizationElementId = value.visualizationElementId;

  return typeof visualizationElementId === "string"
    ? visualizationElementId
    : null;
}

function isOkResult(value: unknown) {
  return isRecord(value) && value.ok === true;
}

function getModeFromResult(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return getStringFromRecord(value, "mode");
}

function getArrayFromRecord(record: UnknownRecord, key: string) {
  const value = record[key];

  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getPartsFromPartsResponse(data: unknown) {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }

  if (!isRecord(data)) {
    return [];
  }

  const directParts = getArrayFromRecord(data, "parts");
  if (directParts.length > 0) return directParts;

  const items = getArrayFromRecord(data, "items");
  if (items.length > 0) return items;

  const dataItems = getArrayFromRecord(data, "data");
  if (dataItems.length > 0) return dataItems;

  return [];
}

function getPartIdFromPartRecord(part: UnknownRecord) {
  return (
    getStringFromRecord(part, "partId") ??
    getStringFromRecord(part, "id") ??
    getStringFromRecord(part, "partIdOrMicroversionId")
  );
}

async function getPartIdsFromVisualizationLayer(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  visualizationElementId: string;
  accessToken: string;
}) {
  const endpoint = `${input.server}/api/parts/d/${input.documentId}/w/${input.workspaceId}/e/${input.visualizationElementId}`;

  const res = await onshapeFetch(
    endpoint,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
      },
    },
    {
      route: "/api/fuzzycad/save-project",
      operation: "get-visualization-layer-parts",
    },
  );

  const data = await parseJsonOrText(res);

  if (!res.ok) {
    return {
      ok: false,
      mode: "failed-to-read-visualization-layer-parts",
      status: res.status,
      endpoint,
      data,
      partIds: [] as string[],
    };
  }

  const parts = getPartsFromPartsResponse(data);
  const partIds = parts
    .map((part) => getPartIdFromPartRecord(part))
    .filter((partId): partId is string => Boolean(partId));

  if (partIds.length === 0) {
    return {
      ok: false,
      mode: "visualization-layer-has-no-readable-part-ids",
      status: res.status,
      endpoint,
      data,
      partsPreview: parts.slice(0, 10),
      partIds,
    };
  }

  return {
    ok: true,
    mode: "found-visualization-layer-parts",
    status: res.status,
    endpoint,
    data,
    partsPreview: parts.slice(0, 10),
    partIds,
  };
}

async function getAssemblyDefinitionForOverlay(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  accessToken: string;
}) {
  return getCachedAssembly({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    assemblyElementId: input.assemblyElementId,
    accessToken: input.accessToken,
    route: "/api/fuzzycad/save-project",
  });
}

function getAssemblyInstances(data: unknown) {
  if (!isRecord(data)) {
    return [];
  }

  const rootAssembly = isRecord(data.rootAssembly) ? data.rootAssembly : data;

  return getArrayFromRecord(rootAssembly, "instances");
}

function getInstanceId(instance: UnknownRecord) {
  return (
    getStringFromRecord(instance, "id") ??
    getStringFromRecord(instance, "instanceId") ??
    getStringFromRecord(instance, "nodeId")
  );
}

function getInstanceName(instance: UnknownRecord) {
  return (
    getStringFromRecord(instance, "name") ??
    getStringFromRecord(instance, "instanceName")
  );
}

function addStringToSet(set: Set<string>, value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    set.add(value);
  }
}

function collectPreviousVisualizationElementIds(projectState: UnknownRecord) {
  const ids = new Set<string>();

  const generatedGeometry = isRecord(projectState.generatedGeometry)
    ? projectState.generatedGeometry
    : null;

  if (!generatedGeometry) {
    return ids;
  }

  const visualizationLayer = isRecord(generatedGeometry.visualizationLayer)
    ? generatedGeometry.visualizationLayer
    : null;

  addStringToSet(ids, visualizationLayer?.elementId);

  const reconstruction = isRecord(generatedGeometry.reconstruction)
    ? generatedGeometry.reconstruction
    : null;

  addStringToSet(ids, reconstruction?.visualizationElementId);

  const assemblyOverlay = isRecord(generatedGeometry.assemblyOverlay)
    ? generatedGeometry.assemblyOverlay
    : null;

  const assemblyOverlayResult = isRecord(assemblyOverlay?.result)
    ? assemblyOverlay.result
    : null;

  addStringToSet(ids, assemblyOverlayResult?.visualizationElementId);

  const directAssemblyOverlayResult = isRecord(
    generatedGeometry.assemblyOverlayResult,
  )
    ? generatedGeometry.assemblyOverlayResult
    : null;

  addStringToSet(ids, directAssemblyOverlayResult?.visualizationElementId);

  return ids;
}

function findExistingOverlayInstances(input: {
  assemblyData: unknown;
  visualizationElementId: string;
  previousVisualizationElementIds: Set<string>;
}) {
  const instances = getAssemblyInstances(input.assemblyData);

  const knownVisualizationElementIds = new Set<string>([
    input.visualizationElementId,
    ...input.previousVisualizationElementIds,
  ]);

  return instances
    .map((instance) => {
      const id = getInstanceId(instance);
      const name = getInstanceName(instance);
      const elementId = getStringFromRecord(instance, "elementId");
      const partId = getStringFromRecord(instance, "partId");

      return {
        id,
        name,
        elementId,
        partId,
        instance,
      };
    })
    .filter((instance) => {
      if (instance.name === ASSEMBLY_OVERLAY_INSTANCE_NAME) {
        return true;
      }

      if (
        instance.elementId &&
        knownVisualizationElementIds.has(instance.elementId)
      ) {
        return true;
      }

      return false;
    });
}

async function insertVisualizationLayerInstances(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  visualizationElementId: string;
  partIds: string[];
  accessToken: string;
}) {
  const endpoint = `${input.server}/api/assemblies/d/${input.documentId}/w/${input.workspaceId}/e/${input.assemblyElementId}/instances`;

  const inserted = [];
  const failed = [];

  for (let index = 0; index < input.partIds.length; index += 1) {
    const partId = input.partIds[index];

    const candidateBodies = [
      {
        documentId: input.documentId,
        elementId: input.visualizationElementId,
        partId,
        isAssembly: false,
        configuration: "default",
        name:
          input.partIds.length === 1
            ? ASSEMBLY_OVERLAY_INSTANCE_NAME
            : `${ASSEMBLY_OVERLAY_INSTANCE_NAME}_${index + 1}`,
      },
      {
        documentId: input.documentId,
        elementId: input.visualizationElementId,
        partId,
        isAssembly: false,
        configuration: "default",
        instanceName:
          input.partIds.length === 1
            ? ASSEMBLY_OVERLAY_INSTANCE_NAME
            : `${ASSEMBLY_OVERLAY_INSTANCE_NAME}_${index + 1}`,
      },
      {
        documentId: input.documentId,
        elementId: input.visualizationElementId,
        partId,
        isAssembly: false,
        configuration: "default",
      },
    ];

    const attempts = [];
    let insertedThisPart = false;

    for (const requestBody of candidateBodies) {
      const res = await onshapeFetch(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
        {
          route: "/api/fuzzycad/save-project",
          operation: "insert-fuzzycad-visualization-overlay-part",
        },
      );

      const data = await parseJsonOrText(res);

      attempts.push({
        ok: res.ok,
        status: res.status,
        endpoint,
        requestBody,
        data,
      });

      if (res.ok) {
        inserted.push({
          partId,
          status: res.status,
          endpoint,
          requestBody,
          data,
          attempts,
        });

        insertedThisPart = true;
        break;
      }
    }

    if (!insertedThisPart) {
      failed.push({
        partId,
        attempts,
      });
    }
  }

  if (failed.length > 0) {
    return {
      ok: false,
      mode: "failed-to-insert-some-visualization-layer-parts",
      endpoint,
      visualizationElementId: input.visualizationElementId,
      partIds: input.partIds,
      inserted,
      failed,
    };
  }

  return {
    ok: true,
    mode: "inserted-visualization-layer-parts-into-assembly",
    status: 200,
    endpoint,
    visualizationElementId: input.visualizationElementId,
    partIds: input.partIds,
    insertedCount: inserted.length,
    inserted,
  };
}

function collectFuzzyCadImportedVisualizationElementIds(elements: unknown) {
  const ids = new Set<string>();

  if (!Array.isArray(elements)) {
    return ids;
  }

  for (const element of elements.filter(isRecord)) {
    const id = getElementId(element);
    const name = getElementName(element);
    const typeLabel = getElementTypeLabel(element);

    const isImportedVisualizationLayer =
      name.startsWith("fuzzycad-annotated-selection") ||
      name.startsWith(VISUALIZATION_LAYER_NAME);

    const isPartStudio =
      typeof typeLabel === "string" &&
      typeLabel.toLowerCase().includes("partstudio");

    if (id && isImportedVisualizationLayer && isPartStudio) {
      ids.add(id);
    }
  }

  return ids;
}

async function findExistingFuzzyCadOverlayBeforeImport(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  selectedAssemblyElementId: string | null;
  projectState: UnknownRecord;
}) {
  const currentSelectionSignature = getSelectionSignatureFromProjectState(
    input.projectState,
  );
  const previousSelectionSignature = getPreviousSelectionSignature(
    input.projectState,
  );

  if (!input.selectedAssemblyElementId) {
    return {
      ok: false,
      mode: "missing-selected-assembly",
      shouldSkipImport: false,
      shouldReplaceOverlay: false,
      hasExistingOverlay: false,
      selectionMatches: false,
      currentSelectionSignature,
      previousSelectionSignature,
      existingOverlays: [] as UnknownRecord[],
      knownVisualizationElementIds: [] as string[],
    };
  }

  const elementsResult = await getCachedElements({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    accessToken: input.accessToken,
    route: "/api/fuzzycad/save-project",
  });

  if (!elementsResult.ok || !Array.isArray(elementsResult.data)) {
    return {
      ok: false,
      mode: "failed-to-read-elements-before-overlay-preflight",
      shouldSkipImport: false,
      shouldReplaceOverlay: false,
      hasExistingOverlay: false,
      selectionMatches: false,
      currentSelectionSignature,
      previousSelectionSignature,
      elementsResult,
      existingOverlays: [] as UnknownRecord[],
      knownVisualizationElementIds: [] as string[],
    };
  }

  const assemblyResult = await getAssemblyDefinitionForOverlay({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    assemblyElementId: input.selectedAssemblyElementId,
    accessToken: input.accessToken,
  });

  if (!assemblyResult.ok) {
    return {
      ok: false,
      mode: "failed-to-read-assembly-before-overlay-preflight",
      shouldSkipImport: false,
      shouldReplaceOverlay: false,
      hasExistingOverlay: false,
      selectionMatches: false,
      currentSelectionSignature,
      previousSelectionSignature,
      assemblyResult,
      existingOverlays: [] as UnknownRecord[],
      knownVisualizationElementIds: [] as string[],
    };
  }

  const previousVisualizationElementIds =
    collectPreviousVisualizationElementIds(input.projectState);

  const importedVisualizationElementIds =
    collectFuzzyCadImportedVisualizationElementIds(elementsResult.data);

  const knownVisualizationElementIds = new Set<string>([
    ...previousVisualizationElementIds,
    ...importedVisualizationElementIds,
  ]);

  const existingOverlays = getAssemblyInstances(assemblyResult.data)
    .map((instance) => {
      const id = getInstanceId(instance);
      const name = getInstanceName(instance);
      const elementId = getStringFromRecord(instance, "elementId");
      const partId = getStringFromRecord(instance, "partId");

      return {
        id,
        name,
        elementId,
        partId,
        instance,
      };
    })
    .filter((instance) => {
      return (
        instance.elementId !== null &&
        knownVisualizationElementIds.has(instance.elementId)
      );
    });

  const hasExistingOverlay = existingOverlays.length > 0;
  const selectionMatches =
    previousSelectionSignature !== null &&
    currentSelectionSignature === previousSelectionSignature;

  const shouldSkipImport = hasExistingOverlay && selectionMatches;
  const shouldReplaceOverlay = hasExistingOverlay && !selectionMatches;

  return {
    ok: shouldSkipImport,
    mode: !hasExistingOverlay
      ? "no-existing-fuzzycad-overlay-before-import"
      : selectionMatches
        ? "found-existing-fuzzycad-overlay-same-selection"
        : "found-existing-fuzzycad-overlay-stale-selection",
    shouldSkipImport,
    shouldReplaceOverlay,
    hasExistingOverlay,
    selectionMatches,
    currentSelectionSignature,
    previousSelectionSignature,
    assemblyElementId: input.selectedAssemblyElementId,
    existingOverlays,
    knownVisualizationElementIds: Array.from(knownVisualizationElementIds),
  };
}

function getOverlayDeleteInstanceId(overlay: unknown) {
  if (!isRecord(overlay)) {
    return null;
  }

  const directId =
    getStringFromRecord(overlay, "id") ??
    getStringFromRecord(overlay, "instanceId") ??
    getStringFromRecord(overlay, "nodeId");

  if (directId) {
    return directId;
  }

  const instance = isRecord(overlay.instance) ? overlay.instance : null;

  if (!instance) {
    return null;
  }

  return getInstanceId(instance);
}

async function deleteAssemblyInstance(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  instanceId: string;
  accessToken: string;
}) {
  const encodedInstanceId = encodeURIComponent(input.instanceId);

  const candidateEndpoints = [
    {
      mode: "delete-instance-by-nodeid",
      endpoint: `${input.server}/api/assemblies/d/${input.documentId}/w/${input.workspaceId}/e/${input.assemblyElementId}/instance/nodeid/${encodedInstanceId}`,
    },
    {
      mode: "delete-instance-by-instances-id",
      endpoint: `${input.server}/api/assemblies/d/${input.documentId}/w/${input.workspaceId}/e/${input.assemblyElementId}/instances/${encodedInstanceId}`,
    },
  ];

  const attempts: UnknownRecord[] = [];

  for (const candidate of candidateEndpoints) {
    const res = await onshapeFetch(
      candidate.endpoint,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          Accept: "application/json",
        },
      },
      {
        route: "/api/fuzzycad/save-project",
        operation: candidate.mode,
      },
    );

    const data = await parseJsonOrText(res);

    attempts.push({
      ok: res.ok,
      status: res.status,
      mode: candidate.mode,
      endpoint: candidate.endpoint,
      data,
    });

    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        mode: candidate.mode,
        endpoint: candidate.endpoint,
        data,
        attempts,
      };
    }
  }

  return {
    ok: false,
    mode: "failed-to-delete-assembly-instance",
    instanceId: input.instanceId,
    attempts,
  };
}

async function deleteExistingFuzzyCadOverlayInstances(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  accessToken: string;
  existingOverlays: unknown[];
}) {
  const deleted: UnknownRecord[] = [];
  const failed: UnknownRecord[] = [];

  for (const overlay of input.existingOverlays) {
    const instanceId = getOverlayDeleteInstanceId(overlay);

    if (!instanceId) {
      failed.push({
        ok: false,
        mode: "missing-overlay-instance-id",
        overlay,
      });
      continue;
    }

    const deleteResult = await deleteAssemblyInstance({
      server: input.server,
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      assemblyElementId: input.assemblyElementId,
      instanceId,
      accessToken: input.accessToken,
    });

    if (deleteResult.ok) {
      deleted.push({
        instanceId,
        overlay,
        deleteResult,
      });
    } else {
      failed.push({
        instanceId,
        overlay,
        deleteResult,
      });
    }
  }

  if (failed.length > 0) {
    return {
      ok: false,
      mode: "failed-to-delete-some-existing-fuzzycad-overlay-instances",
      deleted,
      failed,
    };
  }

  clearAssemblyCache();

  return {
    ok: true,
    mode: "deleted-existing-fuzzycad-overlay-instances",
    deletedCount: deleted.length,
    deleted,
  };
}

async function ensureVisualizationLayerInSelectedAssembly(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  selectedAssemblyElementId: string | null;
  visualizationElementId: string | null;
  projectState: UnknownRecord;
}) {
  if (!input.selectedAssemblyElementId) {
    return {
      ok: false,
      mode: "missing-selected-assembly",
      message: "Project state does not contain source.assemblyElementId.",
    };
  }

  if (!input.visualizationElementId) {
    return {
      ok: false,
      mode: "missing-visualization-layer",
      message: "No visualizationElementId was produced by STL translation.",
    };
  }

  const assemblyResult = await getAssemblyDefinitionForOverlay({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    assemblyElementId: input.selectedAssemblyElementId,
    accessToken: input.accessToken,
  });

  if (!assemblyResult.ok) {
    return {
      ok: false,
      mode: "failed-to-read-selected-assembly",
      status: assemblyResult.status,
      endpoint: assemblyResult.endpoint,
      data: assemblyResult.data,
    };
  }

  const previousVisualizationElementIds =
    collectPreviousVisualizationElementIds(input.projectState);

  const existingOverlays = findExistingOverlayInstances({
    assemblyData: assemblyResult.data,
    visualizationElementId: input.visualizationElementId,
    previousVisualizationElementIds,
  });

  if (existingOverlays.length > 0) {
    return {
      ok: true,
      mode: "reused-existing-assembly-overlay",
      message:
        "Selected assembly already contains a FuzzyCAD generated overlay. Skipped insertion to avoid duplicates.",
      assemblyElementId: input.selectedAssemblyElementId,
      visualizationElementId: input.visualizationElementId,
      previousVisualizationElementIds: Array.from(
        previousVisualizationElementIds,
      ),
      instanceName: ASSEMBLY_OVERLAY_INSTANCE_NAME,
      existingOverlays,
    };
  }

  const partResult = await getPartIdsFromVisualizationLayer({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    visualizationElementId: input.visualizationElementId,
    accessToken: input.accessToken,
  });

  if (!partResult.ok || partResult.partIds.length === 0) {
    return {
      ok: false,
      mode: "failed-to-find-visualization-layer-parts",
      assemblyElementId: input.selectedAssemblyElementId,
      visualizationElementId: input.visualizationElementId,
      partResult,
    };
  }

  const insertResult = await insertVisualizationLayerInstances({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    assemblyElementId: input.selectedAssemblyElementId,
    visualizationElementId: input.visualizationElementId,
    partIds: partResult.partIds,
    accessToken: input.accessToken,
  });

  if (insertResult.ok) {
    clearAssemblyCache();
  }

  return {
    ...insertResult,
    assemblyElementId: input.selectedAssemblyElementId,
    visualizationElementId: input.visualizationElementId,
    partIds: partResult.partIds,
    instanceName: ASSEMBLY_OVERLAY_INSTANCE_NAME,
    partResult,
  };
}

async function getTranslationStatus(input: {
  href: string;
  accessToken: string;
}) {
  const res = await onshapeFetch(
    input.href,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
      },
    },
    {
      route: "/api/fuzzycad/save-project",
      operation: "get-stl-translation-status",
    },
  );

  return {
    ok: res.ok,
    status: res.status,
    data: await parseJsonOrText(res),
  };
}

function buildStlTranslationFormData(input: {
  annotatedSelectionStl: Blob;
  variant: "import-default" | "import-onshape" | "translate-stl-fallback";
}) {
  const formData = new FormData();

  formData.append(
    "file",
    input.annotatedSelectionStl,
    ANNOTATED_SELECTION_STL_FILENAME,
  );
  formData.append("encodedFilename", ANNOTATED_SELECTION_STL_FILENAME);
  formData.append("storeInDocument", "true");
  formData.append("destinationName", VISUALIZATION_LAYER_NAME);

  /**
   * Important:
   * formatName: "STL" produced a Blob element in our test.
   *
   * So try import-style requests first. The old STL formatName path is kept
   * only as a final diagnostic fallback.
   */
  if (input.variant === "import-onshape") {
    formData.append("formatName", "ONSHAPE");
  }

  if (input.variant === "translate-stl-fallback") {
    formData.append("formatName", "STL");
  }

  formData.append("importInOwnerDocument", "true");
  formData.append("allowFaultyParts", "true");
  formData.append("createComposite", "false");
  formData.append("joinAdjacentSurfaces", "false");

  return formData;
}

async function pollTranslationToCompletion(input: {
  initialData: unknown;
  href: string | null;
  accessToken: string;
}) {
  let translationData = input.initialData;

  if (!input.href) {
    return translationData;
  }

  for (let i = 0; i < 20; i += 1) {
    const state = getTranslationState(translationData);

    if (state === "DONE" || state === "COMPLETED" || state === "SUCCESS") {
      break;
    }

    if (state === "FAILED" || state === "CANCELLED" || state === "ERROR") {
      return translationData;
    }

    await sleep(1000);

    const statusResult = await getTranslationStatus({
      href: input.href,
      accessToken: input.accessToken,
    });

    if (!statusResult.ok) {
      return {
        ok: false,
        mode: "failed-to-poll-stl-translation",
        status: statusResult.status,
        href: input.href,
        data: statusResult.data,
        initialData: translationData,
      };
    }

    translationData = statusResult.data;
  }

  return translationData;
}

async function translateAnnotatedStlIntoVisualizationLayer(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  annotatedSelectionStl: Blob;
  annotatedSelectionStlElementId: string | null;
}) {
  const endpoint = `${input.server}/api/translations/d/${input.documentId}/w/${input.workspaceId}`;

  const variants: {
    variant: "import-default" | "import-onshape" | "translate-stl-fallback";
    description: string;
  }[] = [
    {
      variant: "import-default",
      description:
        "Upload STL without formatName so Onshape can infer import behavior.",
    },
    {
      variant: "import-onshape",
      description:
        "Upload STL with formatName=ONSHAPE to request native document import.",
    },
    {
      variant: "translate-stl-fallback",
      description:
        "Old behavior: formatName=STL. Expected to produce a Blob, kept only for diagnostics.",
    },
  ];

  const attempts = [];

  for (const item of variants) {
    const startRes = await onshapeFetch(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          Accept: "application/json",
        },
        body: buildStlTranslationFormData({
          annotatedSelectionStl: input.annotatedSelectionStl,
          variant: item.variant,
        }),
      },
      {
        route: "/api/fuzzycad/save-project",
        operation: `translate-annotated-stl-${item.variant}`,
      },
    );

    const initialData = await parseJsonOrText(startRes);

    if (!startRes.ok) {
      attempts.push({
        ok: false,
        variant: item.variant,
        description: item.description,
        status: startRes.status,
        endpoint,
        data: initialData,
      });

      continue;
    }

    const href = getTranslationHref(initialData);
    const translationData = await pollTranslationToCompletion({
      initialData,
      href,
      accessToken: input.accessToken,
    });

    const state = getTranslationState(translationData);

    const visualizationElementId = getTranslatedElementId(
      translationData,
      input.annotatedSelectionStlElementId,
    );

    const validation = await validateVisualizationLayerElement({
      server: input.server,
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      accessToken: input.accessToken,
      visualizationElementId,
    });

    const attempt = {
      ok: validation.ok,
      variant: item.variant,
      description: item.description,
      status: startRes.status,
      endpoint,
      sourceBlobElementId: input.annotatedSelectionStlElementId,
      requestBodyKind: "multipart/form-data",
      href,
      state,
      visualizationElementId,
      validation,
      initialData,
      data: translationData,
    };

    attempts.push(attempt);

    if (validation.ok) {
      return {
        ok: true,
        mode: "stl-import-produced-insertable-visualization-layer",
        status: startRes.status,
        endpoint,
        sourceBlobElementId: input.annotatedSelectionStlElementId,
        requestBodyKind: "multipart/form-data",
        href,
        visualizationElementId,
        validation,
        attempts,
        data: translationData,
      };
    }
  }

  const lastAttempt = attempts[attempts.length - 1] ?? null;
  const lastVisualizationElementId =
    getVisualizationElementIdFromAttempt(lastAttempt);

  return {
    ok: false,
    mode: "stl-import-did-not-produce-insertable-visualization-layer",
    status:
      lastAttempt && typeof lastAttempt.status === "number"
        ? lastAttempt.status
        : 500,
    endpoint,
    sourceBlobElementId: input.annotatedSelectionStlElementId,
    visualizationElementId: lastVisualizationElementId,
    attempts,
    data: lastAttempt,
  };
}

function getElementTypeLabel(element: UnknownRecord) {
  return (
    getStringFromRecord(element, "elementType") ??
    getStringFromRecord(element, "type") ??
    getStringFromRecord(element, "dataType")
  );
}

function isBlobLikeElement(element: UnknownRecord) {
  const typeLabel = getElementTypeLabel(element);

  return typeLabel ? typeLabel.toLowerCase().includes("blob") : false;
}

function findElementById(elements: unknown, elementId: string) {
  if (!Array.isArray(elements)) {
    return null;
  }

  return (
    elements
      .filter(isRecord)
      .find((element) => getElementId(element) === elementId) ?? null
  );
}

async function validateVisualizationLayerElement(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  visualizationElementId: string | null;
}) {
  if (!input.visualizationElementId) {
    return {
      ok: false,
      mode: "missing-visualization-element-id",
      visualizationElementId: null,
    };
  }

  const elementsResult = await getCachedElements({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    accessToken: input.accessToken,
    route: "/api/fuzzycad/save-project",
  });

  if (!elementsResult.ok || !Array.isArray(elementsResult.data)) {
    return {
      ok: false,
      mode: "failed-to-validate-visualization-element",
      visualizationElementId: input.visualizationElementId,
      elementsResult,
    };
  }

  const element = findElementById(
    elementsResult.data,
    input.visualizationElementId,
  );

  if (!element) {
    return {
      ok: false,
      mode: "visualization-element-not-found",
      visualizationElementId: input.visualizationElementId,
      elementsPreview: elementsResult.data.filter(isRecord).slice(-10),
    };
  }

  if (isBlobLikeElement(element)) {
    return {
      ok: false,
      mode: "visualization-element-is-blob-not-partstudio",
      visualizationElementId: input.visualizationElementId,
      element,
      message:
        "STL translation produced a Blob element, not a Part Studio / Part. This cannot be inserted through the parts endpoint.",
    };
  }

  return {
    ok: true,
    mode: "visualization-element-is-insertable-candidate",
    visualizationElementId: input.visualizationElementId,
    element,
  };
}

function getProjectSource(projectState: UnknownRecord) {
  return isRecord(projectState.source) ? projectState.source : {};
}

function getSourceAssemblyElementId(projectState: UnknownRecord) {
  const source = getProjectSource(projectState);
  const assemblyElementId = source.assemblyElementId;

  return typeof assemblyElementId === "string" && assemblyElementId.length > 0
    ? assemblyElementId
    : null;
}

function buildAnnotatedSelectionManifest(projectState: UnknownRecord) {
  const annotations = Array.isArray(projectState.annotations)
    ? projectState.annotations
    : [];

  const includedObjects: {
    annotationId: string;
    pathKey: string;
    type: string;
  }[] = [];

  for (const annotation of annotations) {
    if (!isRecord(annotation)) continue;
    if (annotation.type !== "size") continue;

    const annotationId =
      typeof annotation.id === "string" ? annotation.id : "unknown-annotation";

    const target = isRecord(annotation.target) ? annotation.target : null;
    const pathKeys = Array.isArray(target?.pathKeys)
      ? target.pathKeys.filter(
          (item): item is string => typeof item === "string",
        )
      : [];

    for (const pathKey of pathKeys) {
      includedObjects.push({
        annotationId,
        pathKey,
        type: "size",
      });
    }
  }

  return {
    objectCount: includedObjects.length,
    includedObjects,
  };
}

function getSelectionSignatureFromProjectState(projectState: UnknownRecord) {
  const manifest = buildAnnotatedSelectionManifest(projectState);

  return manifest.includedObjects
    .map((item) => `${item.annotationId}:${item.type}:${item.pathKey}`)
    .sort()
    .join("|");
}

function getPreviousSelectionSignature(projectState: UnknownRecord) {
  const generatedGeometry = isRecord(projectState.generatedGeometry)
    ? projectState.generatedGeometry
    : null;

  if (!generatedGeometry) {
    return null;
  }

  const directSignature = generatedGeometry.selectionSignature;
  if (typeof directSignature === "string") {
    return directSignature;
  }

  const annotatedSelectionStl = isRecord(
    generatedGeometry.annotatedSelectionStl,
  )
    ? generatedGeometry.annotatedSelectionStl
    : null;

  const stlSignature = annotatedSelectionStl?.selectionSignature;

  return typeof stlSignature === "string" ? stlSignature : null;
}

function getPreviousVisualizationLayerElementId(projectState: UnknownRecord) {
  const generatedGeometry = isRecord(projectState.generatedGeometry)
    ? projectState.generatedGeometry
    : null;

  if (!generatedGeometry) {
    return null;
  }

  const visualizationLayer = isRecord(generatedGeometry.visualizationLayer)
    ? generatedGeometry.visualizationLayer
    : null;

  const visualizationLayerElementId = visualizationLayer?.elementId;
  if (typeof visualizationLayerElementId === "string") {
    return visualizationLayerElementId;
  }

  const reconstruction = isRecord(generatedGeometry.reconstruction)
    ? generatedGeometry.reconstruction
    : null;

  const reconstructionElementId = reconstruction?.visualizationElementId;
  if (typeof reconstructionElementId === "string") {
    return reconstructionElementId;
  }

  return null;
}

function getResolvedVisualizationLayerElementId(input: {
  projectState: UnknownRecord;
  reconstructionResult: unknown;
}) {
  return (
    getVisualizationElementIdFromResult(input.reconstructionResult) ??
    getPreviousVisualizationLayerElementId(input.projectState)
  );
}

function buildGeneratedGeometryPayload(input: {
  projectState: UnknownRecord;
  annotatedSelectionStlResult: UpsertBlobResult | null;
  reconstructionResult: UnknownRecord | null;
  assemblyOverlayResult: UnknownRecord | null;
}) {
  const now = new Date().toISOString();
  const source = getProjectSource(input.projectState);
  const selectedAssemblyElementId = getSourceAssemblyElementId(
    input.projectState,
  );
  const annotatedSelectionManifest = buildAnnotatedSelectionManifest(
    input.projectState,
  );

  const selectionSignature = getSelectionSignatureFromProjectState(
  input.projectState,
);

const visualizationLayerElementId = getResolvedVisualizationLayerElementId({
  projectState: input.projectState,
  reconstructionResult: input.reconstructionResult,
});

  const assemblyOverlayOk = isOkResult(input.assemblyOverlayResult);
  const assemblyOverlayMode = getModeFromResult(input.assemblyOverlayResult);

  return {
    schemaVersion: "fuzzycad.generatedGeometry.v1",
    updatedAt: now,
      selectionSignature,

    source,
    objectMap: input.projectState.objectMap ?? {},
    annotations: input.projectState.annotations ?? [],

    annotatedSelectionStl: input.annotatedSelectionStlResult
      ? {
           filename: input.annotatedSelectionStlResult.filename,
      elementId: input.annotatedSelectionStlResult.elementId,
      mode: input.annotatedSelectionStlResult.mode,
      status: input.annotatedSelectionStlResult.status,
      updatedAt: now,
      coordinateSpace: "onshape-assembly",
      selectionSignature,
          ...annotatedSelectionManifest,
        }
      : null,

    visualizationLayer: {
      name: VISUALIZATION_LAYER_NAME,
      elementId: visualizationLayerElementId,
      status: visualizationLayerElementId ? "ready" : "missing",
    },

    assemblyOverlay: selectedAssemblyElementId
      ? {
          assemblyElementId: selectedAssemblyElementId,
          instanceName: ASSEMBLY_OVERLAY_INSTANCE_NAME,
          status: assemblyOverlayOk
            ? "inserted-or-reused"
            : "pending-insertion",
          mode: assemblyOverlayMode,
          result: input.assemblyOverlayResult,
        }
      : null,

    generatedGeometry: isRecord(input.projectState.generatedGeometry)
      ? input.projectState.generatedGeometry
      : {
          mode: "imported-mesh",
          containerElementId: null,
          manifest: {
            visualObjects: [],
          },
        },
  };
}

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet" },
      { status: 401 },
    );
  }

  let parsedRequest: ParsedSaveProjectRequest;

  try {
    parsedRequest = await parseSaveProjectRequest(req);
  } catch {
    return NextResponse.json(
      { error: "Invalid save project request body" },
      { status: 400 },
    );
  }

  const {
    documentId,
    workspaceId,
    server = "https://cad.onshape.com",
    projectState,
  } = parsedRequest.body;

  const { annotatedSelectionStl } = parsedRequest;

  if (!documentId || !workspaceId || !projectState) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or projectState" },
      { status: 400 },
    );
  }

  const elementsResult = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/fuzzycad/save-project",
  });

  if (!elementsResult.ok || !Array.isArray(elementsResult.data)) {
    return NextResponse.json(
      {
        ...elementsResult,
        ok: false,
        error:
          "Failed to inspect document elements before saving FuzzyCAD project.",
      },
      { status: elementsResult.status },
    );
  }

  const annotatedSelectionStlResult = annotatedSelectionStl
    ? await upsertBlobContainer({
        server,
        documentId,
        workspaceId,
        accessToken,
        filename: ANNOTATED_SELECTION_STL_FILENAME,
        blobData: annotatedSelectionStl,
        elements: elementsResult.data,
        route: "/api/fuzzycad/save-project",
        createOperation: "create-annotated-selection-stl",
        updateOperation: "update-annotated-selection-stl",
      })
    : null;

  if (annotatedSelectionStlResult && !annotatedSelectionStlResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to save FuzzyCAD annotated selection STL.",
        annotatedSelectionStlResult,
      },
      { status: annotatedSelectionStlResult.status },
    );
  }

  const selectedAssemblyElementId = getSourceAssemblyElementId(projectState);

  const existingOverlayPreflight =
    await findExistingFuzzyCadOverlayBeforeImport({
      server,
      documentId,
      workspaceId,
      accessToken,
      selectedAssemblyElementId,
      projectState,
    });

  const staleOverlayCleanupResult =
    existingOverlayPreflight.shouldReplaceOverlay && selectedAssemblyElementId
      ? await deleteExistingFuzzyCadOverlayInstances({
          server,
          documentId,
          workspaceId,
          assemblyElementId: selectedAssemblyElementId,
          accessToken,
          existingOverlays: existingOverlayPreflight.existingOverlays,
        })
      : null;

  if (staleOverlayCleanupResult && !staleOverlayCleanupResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Existing FuzzyCAD overlay is stale, but failed to delete old assembly instances. Aborted before importing new overlay to avoid duplicates.",
        existingOverlayPreflight,
        staleOverlayCleanupResult,
      },
      { status: 500 },
    );
  }

  const reconstructionResult = existingOverlayPreflight.shouldSkipImport
    ? {
        ok: true,
        mode: "skipped-stl-import-existing-overlay-same-selection",
        message:
          "Selected assembly already contains a FuzzyCAD overlay for the same selection, so STL import was skipped.",
        existingOverlayPreflight,
      }
    : annotatedSelectionStl
      ? await translateAnnotatedStlIntoVisualizationLayer({
          server,
          documentId,
          workspaceId,
          accessToken,
          annotatedSelectionStl,
          annotatedSelectionStlElementId:
            annotatedSelectionStlResult?.elementId ?? null,
        })
      : {
          ok: false,
          mode: "missing-annotated-selection-stl",
          message: "No annotated selection STL was provided.",
        };

const visualizationElementId = getResolvedVisualizationLayerElementId({
  projectState,
  reconstructionResult,
});

const visualizationLayerValidation = existingOverlayPreflight.shouldSkipImport
  ? {
      ok: true,
      mode: "skipped-validation-existing-overlay-same-selection",
      visualizationElementId,
      existingOverlayPreflight,
    }
  : await validateVisualizationLayerElement({
      server,
      documentId,
      workspaceId,
      accessToken,
      visualizationElementId,
    });

const assemblyOverlayResult = existingOverlayPreflight.shouldSkipImport
  ? {
      ok: true,
      mode: "reused-existing-assembly-overlay-same-selection",
      message:
        "Selected assembly already contains FuzzyCAD overlay instances for the same selection. Skipped insertion.",
      selectedAssemblyElementId,
      visualizationElementId,
      existingOverlayPreflight,
    }
  : visualizationLayerValidation.ok
    ? await ensureVisualizationLayerInSelectedAssembly({
        server,
        documentId,
        workspaceId,
        accessToken,
        selectedAssemblyElementId,
        visualizationElementId,
        projectState,
      })
    : {
        ok: false,
        mode: "visualization-layer-not-insertable",
        selectedAssemblyElementId,
        visualizationElementId,
        validation: visualizationLayerValidation,
      };

  const generatedGeometryPayload = buildGeneratedGeometryPayload({
    projectState,
    annotatedSelectionStlResult,
    reconstructionResult: isRecord(reconstructionResult)
      ? reconstructionResult
      : null,
    assemblyOverlayResult: isRecord(assemblyOverlayResult)
      ? assemblyOverlayResult
      : null,
  });

  const elementsAfterArtifactsResult = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/fuzzycad/save-project",
    force: true,
  });

  if (
    !elementsAfterArtifactsResult.ok ||
    !Array.isArray(elementsAfterArtifactsResult.data)
  ) {
    return NextResponse.json(
      {
        ...elementsAfterArtifactsResult,
        ok: false,
        error:
          "Generated artifacts were saved, but failed to refresh elements before saving generated geometry metadata.",
        annotatedSelectionStlResult,
        assemblyOverlayResult,
        reconstructionResult,
      },
      { status: elementsAfterArtifactsResult.status },
    );
  }

  const generatedGeometryResult = await upsertJsonBlobContainer({
    server,
    documentId,
    workspaceId,
    accessToken,
    filename: GENERATED_GEOMETRY_FILENAME,
    jsonData: generatedGeometryPayload,
    elements: elementsAfterArtifactsResult.data,
    route: "/api/fuzzycad/save-project",
    createOperation: "create-generated-geometry-container",
    updateOperation: "update-generated-geometry-container",
  });

  if (!generatedGeometryResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to save FuzzyCAD generated geometry container.",
        annotatedSelectionStlResult,
        reconstructionResult,
        assemblyOverlayResult,
        generatedGeometryResult,
      },
      { status: generatedGeometryResult.status },
    );
  }

  const selectionSignature = getSelectionSignatureFromProjectState(projectState);

  const projectStateWithGeneratedGeometry = {
    ...projectState,
    generatedGeometry: {
      ...(isRecord(projectState.generatedGeometry)
        ? projectState.generatedGeometry
        : {}),
      mode: annotatedSelectionStlResult ? "imported-mesh" : "none",
        selectionSignature,
      containerElementId: generatedGeometryResult.elementId,
      annotatedSelectionStl: annotatedSelectionStlResult
  ? {
      filename: annotatedSelectionStlResult.filename,
      elementId: annotatedSelectionStlResult.elementId,
      mode: annotatedSelectionStlResult.mode,
      status: annotatedSelectionStlResult.status,
      selectionSignature,
    }
  : null,
      visualizationLayer: isRecord(reconstructionResult)
        ? {
            name: VISUALIZATION_LAYER_NAME,
elementId: visualizationElementId,
            mode: reconstructionResult.mode,
          }
        : null,

      assemblyOverlay: selectedAssemblyElementId
        ? {
            assemblyElementId: selectedAssemblyElementId,
            instanceName: ASSEMBLY_OVERLAY_INSTANCE_NAME,
            status: isOkResult(assemblyOverlayResult)
              ? "inserted-or-reused"
              : "pending-insertion",
            mode: getModeFromResult(assemblyOverlayResult),
            result: assemblyOverlayResult,
          }
        : null,
      lastGeneratedAt: new Date().toISOString(),
      reconstruction: reconstructionResult,
      visualizationLayerValidation,
      assemblyOverlayResult,
    },
  };

  const refreshedElementsResult = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/fuzzycad/save-project",
    force: true,
  });

  if (
    !refreshedElementsResult.ok ||
    !Array.isArray(refreshedElementsResult.data)
  ) {
    return NextResponse.json(
      {
        ...refreshedElementsResult,
        ok: false,
        error:
          "Generated geometry was saved, but failed to refresh elements before saving project state.",
        annotatedSelectionStlResult,
        generatedGeometryResult,
        assemblyOverlayResult,
        reconstructionResult,
      },
      { status: refreshedElementsResult.status },
    );
  }

  const projectStateResult = await upsertJsonBlobContainer({
    server,
    documentId,
    workspaceId,
    accessToken,
    filename: PROJECT_STATE_FILENAME,
    jsonData: projectStateWithGeneratedGeometry,
    elements: refreshedElementsResult.data,
    route: "/api/fuzzycad/save-project",
    createOperation: "create-project-state-container",
    updateOperation: "update-project-state-container",
  });

  if (!projectStateResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Generated geometry was saved, but failed to save FuzzyCAD project state.",
        annotatedSelectionStlResult,
        generatedGeometryResult,
        reconstructionResult,
        assemblyOverlayResult,
        projectStateResult,
      },
      { status: projectStateResult.status },
    );
  }

  clearElementsCache();
  clearAssemblyCache();

return NextResponse.json({
  ok: true,
  status: 200,
  message: "FuzzyCAD project saved.",
  annotatedSelectionStlResult,
  generatedGeometryResult,
  existingOverlayPreflight,
  staleOverlayCleanupResult,
  reconstructionResult,
  visualizationLayerValidation,
  assemblyOverlayResult,
  projectStateResult,
  projectState: projectStateWithGeneratedGeometry,
});
}
