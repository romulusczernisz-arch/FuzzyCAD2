import { NextRequest, NextResponse } from "next/server";
import {
  clearElementsCache,
  getCachedElements,
} from "../../../lib/server/onshapeElementsCache";
import {
  onshapeFetch,
  parseJsonOrText,
  shouldForceRefresh,
} from "../../../lib/server/onshapeApi";

const STATE_FILENAME = "fuzzycad-project-state.json";

type UnknownRecord = Record<string, unknown>;

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

/**
 * 小白解释：
 * 这个函数的作用就是：
 * 从 Onshape document 的所有 elements 里面，
 * 找名字叫 fuzzycad-project-state.json 的 element。
 *
 * 如果找到了，就返回它的 id。
 * 如果没找到，就返回 null。
 */
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

/**
 * GET = 从 Onshape 读取 fuzzycad-project-state.json
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");
  const force = shouldForceRefresh(searchParams);

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId) {
    return NextResponse.json(
      { error: "Missing documentId or workspaceId" },
      { status: 400 },
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet" },
      { status: 401 },
    );
  }

  /**
   * 第一步：
   * 先拿到这个 Onshape document 里面所有 elements。
   */
  const elementsResult = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/fuzzycad/project-state",
    force,
  });

  if (!elementsResult.ok || !Array.isArray(elementsResult.data)) {
    return NextResponse.json(
      {
        ...elementsResult,
        ok: false,
      },
      { status: elementsResult.status },
    );
  }

  /**
   * 第二步：
   * 找有没有 fuzzycad-project-state.json。
   */
  const stateElement = findLatestElementByName(
    elementsResult.data,
    STATE_FILENAME,
  );

  const elementId = stateElement?.id ?? null;

  if (!elementId) {
    return NextResponse.json(
      {
        error: "No FuzzyCAD project state found",
        elementsCache: elementsResult.cache,
      },
      { status: 404 },
    );
  }

  /**
   * 第三步：
   * 如果找到了，就去读这个 blob element 的内容。
   */
  const blobEndpoint = `${server}/api/blobelements/d/${documentId}/w/${workspaceId}/e/${elementId}`;

  const blobRes = await onshapeFetch(
    blobEndpoint,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json,text/plain,*/*",
      },
    },
    {
      route: "/api/fuzzycad/project-state",
      operation: "get-project-state-blob",
    },
  );

  const state = await parseJsonOrText(blobRes);

  return NextResponse.json(
    {
      ok: blobRes.ok,
      status: blobRes.status,
      elementId,
      elementsCache: elementsResult.cache,
      blobEndpoint,
      state,
    },
    { status: blobRes.ok ? 200 : blobRes.status },
  );
}

/**
 * PUT = 把 FuzzyCAD project state 存回 Onshape
 */
export async function PUT(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet" },
      { status: 401 },
    );
  }

  const body = await req.json();

  const {
    documentId,
    workspaceId,
    server = "https://cad.onshape.com",
    state,
  } = body;

  if (!documentId || !workspaceId || !state) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or state" },
      { status: 400 },
    );
  }

  /**
   * 小白解释：
   *
   * 保存之前，先去 Onshape 里看一下：
   * 这个 document 里面是不是已经有 fuzzycad-project-state.json。
   *
   * 如果有，我们就更新它。
   * 如果没有，我们才创建一个新的。
   */
  const elementsResult = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/fuzzycad/project-state",
    force: true,
  });

  if (!elementsResult.ok || !Array.isArray(elementsResult.data)) {
    return NextResponse.json(
      {
        ...elementsResult,
        ok: false,
        error: "Failed to inspect document elements before saving project state.",
      },
      { status: elementsResult.status },
    );
  }

  const existingStateElement = findLatestElementByName(
    elementsResult.data,
    STATE_FILENAME,
  );

  /**
   * 小白解释：
   *
   * FormData 就是上传文件用的格式。
   * 这里我们把 state 变成 JSON 字符串，
   * 然后伪装成一个文件 fuzzycad-project-state.json 上传给 Onshape。
   */
  const formData = new FormData();
  const json = JSON.stringify(state, null, 2);

  formData.append(
    "file",
    new Blob([json], { type: "application/json" }),
    STATE_FILENAME,
  );

  formData.append("encodedFilename", STATE_FILENAME);

  /**
   * 这里是最核心的改动。
   *
   * 如果 existingStateElement 不存在：
   *   endpoint = /api/blobelements/d/{documentId}/w/{workspaceId}
   *   意思是：创建一个新的 blob element。
   *
   * 如果 existingStateElement 存在：
   *   endpoint = /api/blobelements/d/{documentId}/w/{workspaceId}/e/{elementId}
   *   意思是：更新已有的 blob element。
   */
  const endpoint = existingStateElement
    ? `${server}/api/blobelements/d/${documentId}/w/${workspaceId}/e/${existingStateElement.id}`
    : `${server}/api/blobelements/d/${documentId}/w/${workspaceId}`;

  const operation = existingStateElement
    ? "update-project-state-blob"
    : "create-project-state-blob";

  const onshapeRes = await onshapeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      body: formData,
    },
    {
      route: "/api/fuzzycad/project-state",
      operation,
    },
  );

  const data = await parseJsonOrText(onshapeRes);

  /**
   * 如果保存成功，清掉 elements cache。
   * 因为 Onshape document 里的 elements 可能已经变了。
   */
  if (onshapeRes.ok) {
    clearElementsCache();
  }

  return NextResponse.json(
    {
      ok: onshapeRes.ok,
      status: onshapeRes.status,

      /**
       * 你测试的时候主要看这个 mode。
       *
       * 第一次保存应该是 created-container。
       * 第二次保存应该是 updated-existing-container。
       */
      mode: existingStateElement
        ? "updated-existing-container"
        : "created-container",

      elementId: existingStateElement?.id ?? null,
      endpoint,
      data,
    },
    { status: onshapeRes.ok ? 200 : onshapeRes.status },
  );
}