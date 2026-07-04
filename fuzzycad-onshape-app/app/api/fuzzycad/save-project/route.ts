import { NextRequest, NextResponse } from "next/server";
import {
  clearElementsCache,
  getCachedElements,
} from "../../../lib/server/onshapeElementsCache";
import {
  onshapeFetch,
  parseJsonOrText,
} from "../../../lib/server/onshapeApi";

const PROJECT_STATE_FILENAME = "fuzzycad-project-state.json";
const GENERATED_GEOMETRY_FILENAME = "fuzzycad-generated-geometry.json";
const ANNOTATED_SELECTION_GLB_FILENAME = "fuzzycad-annotated-selection.glb";

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
  annotatedSelectionGlb: Blob | null;
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

    const glbValue = formData.get("annotatedSelectionGlb");
    const annotatedSelectionGlb =
      glbValue instanceof Blob && glbValue.size > 0 ? glbValue : null;

    return {
      body: {
        documentId: getStringFormField(formData, "documentId"),
        workspaceId: getStringFormField(formData, "workspaceId"),
        server: getStringFormField(formData, "server") || undefined,
        projectState: parsedProjectState,
      },
      annotatedSelectionGlb,
    };
  }

  const body = (await req.json()) as SaveProjectRequestBody;

  return {
    body,
    annotatedSelectionGlb: null,
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





function buildGeneratedGeometryPayload(input: {
  projectState: UnknownRecord;
}) {
  const now = new Date().toISOString();

  return {
    schemaVersion: "fuzzycad.generatedGeometry.v1",
    updatedAt: now,

    /**
     * 这里先存 reconstruction input。
     * 后面 FeatureScript 那边要用的 metadata，就从这里拿。
     */
    source: input.projectState.source ?? null,
    objectMap: input.projectState.objectMap ?? {},
    annotations: input.projectState.annotations ?? [],

    /**
     * 这里是 FuzzyCAD 自己生成的 visualization manifest。
     * 现在可以是 blur-shell / direction-arrow / dashed-line 这些 semantic objects。
     * 以后再把这些 semantic objects 翻译成 Onshape-native geometry。
     */
    generatedGeometry:
      isRecord(input.projectState.generatedGeometry)
        ? input.projectState.generatedGeometry
        : {
            mode: "none",
            containerElementId: null,
            manifest: {
              visualObjects: [],
            },
          },
  };
}

const VISUALIZATION_LAYER_NAME = "FuzzyCAD_Visualization_Layer";


async function reconstructGeneratedGeometryInOnshape(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  generatedGeometryElementId: string | null;
  projectState: UnknownRecord;
}) {
  const elementsResult = await getCachedElements({
    server: input.server,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    accessToken: input.accessToken,
    route: "/api/fuzzycad/save-project",
    force: true,
  });

  if (!elementsResult.ok || !Array.isArray(elementsResult.data)) {
    return {
      ok: false,
      mode: "failed-to-read-elements",
      message: "Could not read Onshape elements before reconstruction.",
      details: elementsResult,
      generatedGeometryElementId: input.generatedGeometryElementId,
    };
  }

  const existingLayer = findLatestElementByName(
    elementsResult.data,
    VISUALIZATION_LAYER_NAME,
  );

  if (existingLayer) {
    return {
      ok: true,
      mode: "reused-existing-visualization-layer", 
      message: "Found existing FuzzyCAD visualization layer.",
      visualizationElementId: existingLayer.id,
      generatedGeometryElementId: input.generatedGeometryElementId,
    };
  }

  /**
   * Important:
   * Do not use /api/documents/d/{did}/w/{wid}/elements here.
   * That endpoint returned 405 Method Not Allowed.
   *
   * For creating a Part Studio, use the Part Studios endpoint.
   */
  const createElementEndpoint = `${input.server}/api/partstudios/d/${input.documentId}/w/${input.workspaceId}`;

  const createElementBody = {
    name: VISUALIZATION_LAYER_NAME,
  };

  const createElementRes = await onshapeFetch(
    createElementEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createElementBody),
    },
    {
      route: "/api/fuzzycad/save-project",
      operation: "create-fuzzycad-visualization-partstudio",
    },
  );

  const createElementData = await parseJsonOrText(createElementRes);
  const visualizationElementId = getElementIdFromResponse(createElementData);

  if (!createElementRes.ok) {
    return {
      ok: false,
      mode: "failed-to-create-visualization-layer",
      status: createElementRes.status,
      message:
        "Tried to create FuzzyCAD_Visualization_Layer Part Studio, but Onshape rejected the request.",
      endpoint: createElementEndpoint,
      requestBody: createElementBody,
      data: createElementData,
      generatedGeometryElementId: input.generatedGeometryElementId,
    };
  }

  clearElementsCache();

  return {
    ok: true,
    mode: "created-visualization-layer",
    status: createElementRes.status,
    message:
      "Created FuzzyCAD_Visualization_Layer. Next step is adding FeatureScript-generated boxes/arrows.",
    visualizationElementId,
    endpoint: createElementEndpoint,
    data: createElementData,
    generatedGeometryElementId: input.generatedGeometryElementId,
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

  const { annotatedSelectionGlb } = parsedRequest;

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

  /**
   * 1. 如果前端传了 annotated selection GLB，
   * 先把它 upsert 成一个稳定的 Onshape blob element。
   *
   * 文件名固定：
   * fuzzycad-annotated-selection.glb
   *
   * 第二次 Save 会 update existing，不会新增一堆重复 GLB。
   */
  const annotatedSelectionGlbResult = annotatedSelectionGlb
    ? await upsertBlobContainer({
        server,
        documentId,
        workspaceId,
        accessToken,
        filename: ANNOTATED_SELECTION_GLB_FILENAME,
        blobData: annotatedSelectionGlb,
        elements: elementsResult.data,
        route: "/api/fuzzycad/save-project",
        createOperation: "create-annotated-selection-glb",
        updateOperation: "update-annotated-selection-glb",
      })
    : null;

  if (annotatedSelectionGlbResult && !annotatedSelectionGlbResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to save FuzzyCAD annotated selection GLB.",
        annotatedSelectionGlbResult,
      },
      { status: annotatedSelectionGlbResult.status },
    );
  }

  /**
   * 2. 保存 generated geometry metadata。
   * 这里还是 fuzzycad-generated-geometry.json。
   */
  const generatedGeometryPayload = {
    ...buildGeneratedGeometryPayload({
      projectState,
    }),
    annotatedSelectionGlb: annotatedSelectionGlbResult
      ? {
          filename: annotatedSelectionGlbResult.filename,
          elementId: annotatedSelectionGlbResult.elementId,
          mode: annotatedSelectionGlbResult.mode,
          status: annotatedSelectionGlbResult.status,
          updatedAt: new Date().toISOString(),
        }
      : null,
  };

  /**
   * 因为刚刚可能新建了 fuzzycad-annotated-selection.glb，
   * 所以这里重新拉一次 elements，避免 generated geometry JSON 用旧列表。
   */
  const elementsAfterGlbResult = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/fuzzycad/save-project",
    force: true,
  });

  if (!elementsAfterGlbResult.ok || !Array.isArray(elementsAfterGlbResult.data)) {
    return NextResponse.json(
      {
        ...elementsAfterGlbResult,
        ok: false,
        error:
          "Annotated selection GLB was saved, but failed to refresh elements before saving generated geometry metadata.",
        annotatedSelectionGlbResult,
      },
      { status: elementsAfterGlbResult.status },
    );
  }

  const generatedGeometryResult = await upsertJsonBlobContainer({
    server,
    documentId,
    workspaceId,
    accessToken,
    filename: GENERATED_GEOMETRY_FILENAME,
    jsonData: generatedGeometryPayload,
    elements: elementsAfterGlbResult.data,
    route: "/api/fuzzycad/save-project",
    createOperation: "create-generated-geometry-container",
    updateOperation: "update-generated-geometry-container",
  });

  if (!generatedGeometryResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to save FuzzyCAD generated geometry container.",
        annotatedSelectionGlbResult,
        generatedGeometryResult,
      },
      { status: generatedGeometryResult.status },
    );
  }

  /**
   * 3. 创建 / 复用 FuzzyCAD_Visualization_Layer。
   * 现在还不把 GLB import 进去，只先保证 layer 存在。
   */
  const reconstructionResult = await reconstructGeneratedGeometryInOnshape({
    server,
    documentId,
    workspaceId,
    accessToken,
    generatedGeometryElementId: generatedGeometryResult.elementId,
    projectState,
  });

  /**
   * 4. 把 generated geometry 信息写回 project state。
   */
  const projectStateWithGeneratedGeometry = {
    ...projectState,
    generatedGeometry: {
      ...(isRecord(projectState.generatedGeometry)
        ? projectState.generatedGeometry
        : {}),
      mode: annotatedSelectionGlbResult ? "blob-mesh" : "none",
      containerElementId: generatedGeometryResult.elementId,
      annotatedSelectionGlb: annotatedSelectionGlbResult
        ? {
            filename: annotatedSelectionGlbResult.filename,
            elementId: annotatedSelectionGlbResult.elementId,
            mode: annotatedSelectionGlbResult.mode,
            status: annotatedSelectionGlbResult.status,
          }
        : null,
      lastGeneratedAt: new Date().toISOString(),
      reconstruction: reconstructionResult,
    },
  };

  /**
   * 5. 保存 project state JSON。
   */
  const refreshedElementsResult = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/fuzzycad/save-project",
    force: true,
  });

  if (!refreshedElementsResult.ok || !Array.isArray(refreshedElementsResult.data)) {
    return NextResponse.json(
      {
        ...refreshedElementsResult,
        ok: false,
        error:
          "Generated geometry was saved, but failed to refresh elements before saving project state.",
        annotatedSelectionGlbResult,
        generatedGeometryResult,
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
        annotatedSelectionGlbResult,
        generatedGeometryResult,
        projectStateResult,
      },
      { status: projectStateResult.status },
    );
  }

  clearElementsCache();

  return NextResponse.json({
    ok: true,
    status: 200,
    message: "FuzzyCAD project saved.",
    annotatedSelectionGlbResult,
    generatedGeometryResult,
    reconstructionResult,
    projectStateResult,
    projectState: projectStateWithGeneratedGeometry,
  });
}