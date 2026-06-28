import { NextRequest, NextResponse } from "next/server";

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

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function getElements(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
}) {
  const endpoint = `${input.server}/api/documents/d/${input.documentId}/w/${input.workspaceId}/elements`;

  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  const data = parseJson(text);

  if (!res.ok || !Array.isArray(data)) {
    return { ok: false, status: res.status, endpoint, data };
  }

  return { ok: true, status: res.status, endpoint, data };
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");
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

  const elementsResult = await getElements({
    server,
    documentId,
    workspaceId,
    accessToken,
  });

  if (!elementsResult.ok || !Array.isArray(elementsResult.data)) {
    return NextResponse.json(elementsResult, { status: elementsResult.status });
  }

  const stateElements = elementsResult.data
    .filter(isRecord)
    .filter((element) => getElementName(element) === STATE_FILENAME);

  const stateElement = stateElements[stateElements.length - 1];
  const elementId = stateElement ? getElementId(stateElement) : null;

  if (!elementId) {
    return NextResponse.json(
      { error: "No FuzzyCAD project state found" },
      { status: 404 },
    );
  }

  const blobEndpoint = `${server}/api/blobelements/d/${documentId}/w/${workspaceId}/e/${elementId}`;

  const blobRes = await fetch(blobEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json,text/plain,*/*",
    },
  });

  const text = await blobRes.text();
  const state = parseJson(text);

  return NextResponse.json(
    {
      ok: blobRes.ok,
      status: blobRes.status,
      elementId,
      state,
    },
    { status: blobRes.ok ? 200 : blobRes.status },
  );
}

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

  const formData = new FormData();
  const json = JSON.stringify(state, null, 2);

  formData.append(
    "file",
    new Blob([json], { type: "application/json" }),
    STATE_FILENAME,
  );
  formData.append("encodedFilename", STATE_FILENAME);

  const endpoint = `${server}/api/blobelements/d/${documentId}/w/${workspaceId}`;

  const onshapeRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    body: formData,
  });

  const text = await onshapeRes.text();
  const data = parseJson(text);

  return NextResponse.json(
    {
      ok: onshapeRes.ok,
      status: onshapeRes.status,
      endpoint,
      data,
    },
    { status: onshapeRes.ok ? 200 : onshapeRes.status },
  );
}