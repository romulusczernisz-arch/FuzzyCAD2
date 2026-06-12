import { NextRequest, NextResponse } from "next/server";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getStringField(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function getStringArrayField(record: UnknownRecord, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }

  return [];
}

async function parseResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return res.json();
  }

  return res.text();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTranslationStatus(
  href: string,
  accessToken: string
): Promise<UnknownRecord> {
  const res = await fetch(href, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const data = await parseResponse(res);

  if (!res.ok || !isRecord(data)) {
    throw new Error(
      `Failed to fetch translation status: ${res.status} ${JSON.stringify(data)}`
    );
  }

  return data;
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");
  const assemblyElementId = searchParams.get("assemblyElementId");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !assemblyElementId) {
    return NextResponse.json(
      {
        error: "Missing documentId, workspaceId, or assemblyElementId",
      },
      { status: 400 }
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      {
        error: "Not connected to Onshape yet",
        action: "Click Connect Onshape first",
      },
      { status: 401 }
    );
  }

  const exportEndpoint = `${server}/api/assemblies/d/${documentId}/w/${workspaceId}/e/${assemblyElementId}/export/gltf`;

  const exportRes = await fetch(exportEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:
        "application/json, model/gltf-binary, model/gltf+json, application/octet-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      storeInDocument: false,
    }),
  });

  const exportContentType = exportRes.headers.get("content-type") || "";

  if (!exportRes.ok) {
    const errorData = await parseResponse(exportRes);

    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        status: exportRes.status,
        ok: false,
        contentType: exportContentType,
        error: "Failed to start assembly glTF export",
        details: errorData,
      },
      { status: exportRes.status }
    );
  }

  // Case 1: Onshape directly returns a binary GLB/glTF.
  if (
    exportContentType.includes("model/gltf-binary") ||
    exportContentType.includes("model/gltf+json") ||
    exportContentType.includes("application/octet-stream")
  ) {
    const arrayBuffer = await exportRes.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": exportContentType || "model/gltf-binary",
        "Cache-Control": "no-store",
      },
    });
  }

  const initialData = await parseResponse(exportRes);

  if (!isRecord(initialData)) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        status: exportRes.status,
        ok: false,
        contentType: exportContentType,
        error: "Unexpected glTF export response",
        details: initialData,
      },
      { status: 500 }
    );
  }

  const translationHref = getStringField(initialData, ["href"]);
  const translationId = getStringField(initialData, ["id", "requestId"]);
  const initialState = getStringField(initialData, ["requestState"]);

  if (!translationHref) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        status: exportRes.status,
        ok: false,
        contentType: exportContentType,
        error: "Export returned JSON but no translation href",
        data: initialData,
      },
      { status: 500 }
    );
  }

  let statusData: UnknownRecord = initialData;

  // Poll briefly inside this route. If it is still ACTIVE, the frontend can click again.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = getStringField(statusData, ["requestState"]);

    if (state === "DONE" || state === "FAILED") {
      break;
    }

    await sleep(1000);
    statusData = await fetchTranslationStatus(translationHref, accessToken);
  }

  const finalState = getStringField(statusData, ["requestState"]);

  if (finalState !== "DONE") {
    return NextResponse.json({
      endpoint: exportEndpoint,
      status: 202,
      ok: false,
      message: "Translation is not done yet. Click Load Assembly Geometry again.",
      initialState,
      finalState,
      translationHref,
      translationId,
      data: statusData,
    });
  }

  const resultDocumentId =
    getStringField(statusData, ["resultDocumentId", "documentId"]) || documentId;

  const resultExternalDataIds = getStringArrayField(statusData, [
    "resultExternalDataIds",
  ]);

  // Most robust: use returned resultExternalDataIds[0].
  // Fallback: some forum examples use the translation id itself.
  const externalDataId =
    resultExternalDataIds[0] ||
    getStringField(statusData, ["resultExternalDataId"]) ||
    translationId;

  if (!externalDataId) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        status: 500,
        ok: false,
        error: "Translation finished but no external data id was found",
        data: statusData,
      },
      { status: 500 }
    );
  }

  const downloadEndpoint = `${server}/api/documents/d/${resultDocumentId}/externaldata/${externalDataId}`;

  const downloadRes = await fetch(downloadEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:
        "model/gltf-binary, model/gltf+json, application/octet-stream, application/zip",
    },
  });

  const downloadContentType =
    downloadRes.headers.get("content-type") || "application/octet-stream";

  if (!downloadRes.ok) {
    const downloadError = await parseResponse(downloadRes);

    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        translationHref,
        downloadEndpoint,
        status: downloadRes.status,
        ok: false,
        error: "Failed to download translated glTF external data",
        translation: statusData,
        details: downloadError,
      },
      { status: downloadRes.status }
    );
  }

  const arrayBuffer = await downloadRes.arrayBuffer();

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": downloadContentType,
      "Cache-Control": "no-store",
      "X-FuzzyCAD-Translation-Id": translationId || "",
      "X-FuzzyCAD-External-Data-Id": externalDataId,
    },
  });
}