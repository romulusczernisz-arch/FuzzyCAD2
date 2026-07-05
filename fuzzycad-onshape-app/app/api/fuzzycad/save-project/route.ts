import { NextRequest, NextResponse } from "next/server";
import {
  clearElementsCache,
  getCachedElements,
} from "../../../lib/server/onshapeElementsCache";
import { clearAssemblyCache } from "../../../lib/server/onshapeAssemblyCache";
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

function getTranslatedElementId(data: unknown) {
  if (!isRecord(data)) return null;

  const directElementId =
    getStringFromRecord(data, "resultElementId") ??
    getStringFromRecord(data, "elementId") ??
    getStringFromRecord(data, "elementIdOrMicroversionId");

  if (directElementId) return directElementId;

  return (
    getFirstStringFromArrayField(data, "resultElementIds") ??
    getFirstStringFromArrayField(data, "elementIds") ??
    getFirstStringFromArrayField(data, "createdElementIds")
  );
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

async function getFirstPartIdFromVisualizationLayer(input: {
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
      partId: null,
    };
  }

  const parts = getPartsFromPartsResponse(data);
  const firstPart = parts[0] ?? null;
  const partId = firstPart ? getPartIdFromPartRecord(firstPart) : null;

  if (!partId) {
    return {
      ok: false,
      mode: "visualization-layer-has-no-readable-part-id",
      status: res.status,
      endpoint,
      data,
      partsPreview: parts.slice(0, 5),
      partId: null,
    };
  }

  return {
    ok: true,
    mode: "found-visualization-layer-part",
    status: res.status,
    endpoint,
    data,
    partsPreview: parts.slice(0, 5),
    partId,
  };
}

async function getAssemblyDefinitionForOverlay(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  accessToken: string;
}) {
  const endpoint = `${input.server}/api/assemblies/d/${input.documentId}/w/${input.workspaceId}/e/${input.assemblyElementId}`;

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
      operation: "get-selected-assembly-before-overlay-insert",
    },
  );

  return {
    ok: res.ok,
    status: res.status,
    endpoint,
    data: await parseJsonOrText(res),
  };
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

function findExistingOverlayInstance(input: {
  assemblyData: unknown;
  visualizationElementId: string;
}) {
  const instances = getAssemblyInstances(input.assemblyData);

  const matched =
    instances.find((instance) => {
      const name = getInstanceName(instance);
      const elementId = getStringFromRecord(instance, "elementId");

      return (
        name === ASSEMBLY_OVERLAY_INSTANCE_NAME ||
        elementId === input.visualizationElementId
      );
    }) ?? null;

  if (!matched) {
    return null;
  }

  return {
    id: getInstanceId(matched),
    name: getInstanceName(matched),
    elementId: getStringFromRecord(matched, "elementId"),
    instance: matched,
  };
}

async function insertVisualizationLayerInstance(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  visualizationElementId: string;
  partId: string;
  accessToken: string;
}) {
  const endpoint = `${input.server}/api/assemblies/d/${input.documentId}/w/${input.workspaceId}/e/${input.assemblyElementId}/instances`;

  /**
   * Onshape instance insertion payloads can be picky depending on whether
   * the source is a part, mesh import, or whole part studio.
   *
   * Try name/instanceName/no-name variants. The first accepted request wins.
   * If all fail, the response includes every attempt for debugging.
   */
  const candidateBodies = [
    {
      documentId: input.documentId,
      elementId: input.visualizationElementId,
      partId: input.partId,
      isAssembly: false,
      configuration: "default",
      name: ASSEMBLY_OVERLAY_INSTANCE_NAME,
    },
    {
      documentId: input.documentId,
      elementId: input.visualizationElementId,
      partId: input.partId,
      isAssembly: false,
      configuration: "default",
      instanceName: ASSEMBLY_OVERLAY_INSTANCE_NAME,
    },
    {
      documentId: input.documentId,
      elementId: input.visualizationElementId,
      partId: input.partId,
      isAssembly: false,
      configuration: "default",
    },
  ];

  const attempts = [];

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
        operation: "insert-fuzzycad-visualization-overlay",
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
      return {
        ok: true,
        mode: "inserted-visualization-layer-into-assembly",
        status: res.status,
        endpoint,
        requestBody,
        data,
        attempts,
      };
    }
  }

  return {
    ok: false,
    mode: "failed-to-insert-visualization-layer-into-assembly",
    endpoint,
    attempts,
  };
}

async function ensureVisualizationLayerInSelectedAssembly(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  selectedAssemblyElementId: string | null;
  visualizationElementId: string | null;
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

  const existingOverlay = findExistingOverlayInstance({
    assemblyData: assemblyResult.data,
    visualizationElementId: input.visualizationElementId,
  });

  if (existingOverlay) {
    return {
      ok: true,
      mode: "reused-existing-assembly-overlay",
      message:
        "Selected assembly already contains the FuzzyCAD generated overlay.",
      assemblyElementId: input.selectedAssemblyElementId,
      visualizationElementId: input.visualizationElementId,
      instanceName: ASSEMBLY_OVERLAY_INSTANCE_NAME,
      existingOverlay,
    };
  }

  const partResult = await getFirstPartIdFromVisualizationLayer({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    visualizationElementId: input.visualizationElementId,
    accessToken: input.accessToken,
  });

  if (!partResult.ok || !partResult.partId) {
    return {
      ok: false,
      mode: "failed-to-find-visualization-layer-part",
      assemblyElementId: input.selectedAssemblyElementId,
      visualizationElementId: input.visualizationElementId,
      partResult,
    };
  }

  const insertResult = await insertVisualizationLayerInstance({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    assemblyElementId: input.selectedAssemblyElementId,
    visualizationElementId: input.visualizationElementId,
    partId: partResult.partId,
    accessToken: input.accessToken,
  });

  if (insertResult.ok) {
    clearAssemblyCache();
  }

  return {
    ...insertResult,
    assemblyElementId: input.selectedAssemblyElementId,
    visualizationElementId: input.visualizationElementId,
    partId: partResult.partId,
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

async function translateAnnotatedStlIntoVisualizationLayer(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  annotatedSelectionStlElementId: string;
}) {
  const endpoint = `${input.server}/api/translations/d/${input.documentId}/w/${input.workspaceId}`;

  const requestBody = {
    elementId: input.annotatedSelectionStlElementId,
    formatName: "STL",
    storeInDocument: true,
    destinationName: VISUALIZATION_LAYER_NAME,
  };

  const startRes = await onshapeFetch(
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
      operation: "translate-annotated-stl-into-visualization-layer",
    },
  );

  let translationData = await parseJsonOrText(startRes);

  if (!startRes.ok) {
    return {
      ok: false,
      mode: "failed-to-start-stl-translation",
      status: startRes.status,
      endpoint,
      requestBody,
      data: translationData,
    };
  }

  const href = getTranslationHref(translationData);

  if (href) {
    for (let i = 0; i < 20; i += 1) {
      const state = getTranslationState(translationData);

      if (state === "DONE" || state === "COMPLETED" || state === "SUCCESS") {
        break;
      }

      if (state === "FAILED" || state === "CANCELLED" || state === "ERROR") {
        return {
          ok: false,
          mode: "stl-translation-failed",
          status: startRes.status,
          endpoint,
          requestBody,
          href,
          data: translationData,
        };
      }

      await sleep(1000);

      const statusResult = await getTranslationStatus({
        href,
        accessToken: input.accessToken,
      });

      if (!statusResult.ok) {
        return {
          ok: false,
          mode: "failed-to-poll-stl-translation",
          status: statusResult.status,
          endpoint,
          requestBody,
          href,
          data: statusResult.data,
          initialData: translationData,
        };
      }

      translationData = statusResult.data;
    }
  }

  const visualizationElementId = getTranslatedElementId(translationData);

  return {
    ok: true,
    mode: visualizationElementId
      ? "stl-translated-to-visualization-layer"
      : "stl-translation-started-but-result-element-not-found",
    status: startRes.status,
    endpoint,
    requestBody,
    href,
    visualizationElementId,
    data: translationData,
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

  const visualizationLayerElementId = getVisualizationElementIdFromResult(
    input.reconstructionResult,
  );

  const assemblyOverlayOk = isOkResult(input.assemblyOverlayResult);
  const assemblyOverlayMode = getModeFromResult(input.assemblyOverlayResult);

  return {
    schemaVersion: "fuzzycad.generatedGeometry.v1",
    updatedAt: now,

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
    force: true,
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

  const reconstructionResult = annotatedSelectionStlResult?.elementId
    ? await translateAnnotatedStlIntoVisualizationLayer({
        server,
        documentId,
        workspaceId,
        accessToken,
        annotatedSelectionStlElementId: annotatedSelectionStlResult.elementId,
      })
    : {
        ok: false,
        mode: "missing-annotated-selection-stl",
        message: "No annotated selection STL was provided.",
      };

  const selectedAssemblyElementId = getSourceAssemblyElementId(projectState);
  const visualizationElementId =
    getVisualizationElementIdFromResult(reconstructionResult);

  const assemblyOverlayResult =
    await ensureVisualizationLayerInSelectedAssembly({
      server,
      documentId,
      workspaceId,
      accessToken,
      selectedAssemblyElementId,
      visualizationElementId,
    });

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

  const projectStateWithGeneratedGeometry = {
    ...projectState,
    generatedGeometry: {
      ...(isRecord(projectState.generatedGeometry)
        ? projectState.generatedGeometry
        : {}),
      mode: annotatedSelectionStlResult ? "imported-mesh" : "none",
      containerElementId: generatedGeometryResult.elementId,
      annotatedSelectionStl: annotatedSelectionStlResult
        ? {
            filename: annotatedSelectionStlResult.filename,
            elementId: annotatedSelectionStlResult.elementId,
            mode: annotatedSelectionStlResult.mode,
            status: annotatedSelectionStlResult.status,
          }
        : null,
      visualizationLayer: isRecord(reconstructionResult)
        ? {
            name: VISUALIZATION_LAYER_NAME,
            elementId:
              getVisualizationElementIdFromResult(reconstructionResult),
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
    reconstructionResult,
    assemblyOverlayResult,
    projectStateResult,
    projectState: projectStateWithGeneratedGeometry,
  });
}
