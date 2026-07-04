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
  const existingElement = findLatestElementByName(
    input.elements,
    input.filename,
  );

  const formData = new FormData();
  const json = JSON.stringify(input.jsonData, null, 2);

  formData.append(
    "file",
    new Blob([json], { type: "application/json" }),
    input.filename,
  );

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
  /**
   * Step 1:
   * 重新读取 document elements。
   * 目的：看这个 document 里面是不是已经有 FuzzyCAD_Visualization_Layer。
   */
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

  /**
   * Step 2:
   * 如果已经有 FuzzyCAD_Visualization_Layer，就先复用它。
   */
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
   * Step 3:
   * 如果没有，就尝试创建一个新的 Part Studio element。
   *
   * 注意：
   * 这里我们先创建空 Part Studio。
   * 下一步再把 FeatureScript / bounding boxes / arrows 写进去。
   */
  const createElementEndpoint = `${input.server}/api/documents/d/${input.documentId}/w/${input.workspaceId}/elements`;

  const createElementBody = {
    name: VISUALIZATION_LAYER_NAME,
    elementType: "PARTSTUDIO",
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
        "Tried to create FuzzyCAD_Visualization_Layer, but Onshape rejected the request.",
      endpoint: createElementEndpoint,
      requestBody: createElementBody,
      data: createElementData,
      generatedGeometryElementId: input.generatedGeometryElementId,
    };
  }

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

  let body: SaveProjectRequestBody;

  try {
    body = (await req.json()) as SaveProjectRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const {
    documentId,
    workspaceId,
    server = "https://cad.onshape.com",
    projectState,
  } = body;

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
        error: "Failed to inspect document elements before saving FuzzyCAD project.",
      },
      { status: elementsResult.status },
    );
  }

  /**
   * 1. 先保存 generated geometry container。
   */
  const generatedGeometryPayload = buildGeneratedGeometryPayload({
    projectState,
  });

  const generatedGeometryResult = await upsertJsonBlobContainer({
    server,
    documentId,
    workspaceId,
    accessToken,
    filename: GENERATED_GEOMETRY_FILENAME,
    jsonData: generatedGeometryPayload,
    elements: elementsResult.data,
    route: "/api/fuzzycad/save-project",
    createOperation: "create-generated-geometry-container",
    updateOperation: "update-generated-geometry-container",
  });

  if (!generatedGeometryResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to save FuzzyCAD generated geometry container.",
        generatedGeometryResult,
      },
      { status: generatedGeometryResult.status },
    );
  }

  /**
   * 2. 预留 Onshape-native reconstruction。
   * 现在它不真的生成 FeatureScript geometry，但 pipeline 已经留好了。
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
   * 3. 把 generated geometry container 的 elementId 写回 project state。
   */
  const projectStateWithGeneratedGeometry = {
    ...projectState,
    generatedGeometry: {
      ...(isRecord(projectState.generatedGeometry)
        ? projectState.generatedGeometry
        : {}),
      mode: "blob-mesh",
      containerElementId: generatedGeometryResult.elementId,
      lastGeneratedAt: new Date().toISOString(),
      reconstruction: reconstructionResult,
    },
  };

  /**
   * 注意：
   * 因为刚刚可能新建了 generated geometry element，
   * 所以这里重新拉一次 elements，避免 project-state upsert 用旧列表。
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
        generatedGeometryResult,
      },
      { status: refreshedElementsResult.status },
    );
  }

  /**
   * 4. 再保存 project state container。
   */
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
    generatedGeometryResult,
    reconstructionResult,
    projectStateResult,
    projectState: projectStateWithGeneratedGeometry,
  });
}