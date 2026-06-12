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

function isZip(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isGlb(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer);
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

async function getTranslationStatus(
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
        "application/json, model/gltf-binary, model/gltf+json, application/octet-stream, application/zip",
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

  if (
    exportContentType.includes("model/gltf-binary") ||
    exportContentType.includes("model/gltf+json") ||
    exportContentType.includes("application/octet-stream") ||
    exportContentType.includes("application/zip")
  ) {
    const directBuffer = await exportRes.arrayBuffer();

    if (isZip(directBuffer)) {
      return NextResponse.json(
        {
          endpoint: exportEndpoint,
          status: 415,
          ok: false,
          fileKind: "zip",
          contentType: exportContentType,
          error:
            "Onshape returned a ZIP package. This cannot be passed directly to GLTFLoader; otherwise it causes the PK unexpected-token error.",
          next:
            "Next step: unzip it server-side and load the .gltf/.bin/textures inside, or request a single GLB if Onshape supports that option.",
        },
        { status: 415 }
      );
    }

    if (!isGlb(directBuffer)) {
      return NextResponse.json(
        {
          endpoint: exportEndpoint,
          status: 415,
          ok: false,
          fileKind: "unknown-binary",
          contentType: exportContentType,
          firstBytes: Array.from(new Uint8Array(directBuffer.slice(0, 12))),
          error: "Binary response was not ZIP, but also not GLB.",
        },
        { status: 415 }
      );
    }

    return new NextResponse(directBuffer, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
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
        error: "Unexpected export response",
        details: initialData,
      },
      { status: 500 }
    );
  }

  const translationHref = getStringField(initialData, ["href"]);
  const translationId = getStringField(initialData, ["id", "requestId"]);

  if (!translationHref) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        status: exportRes.status,
        ok: false,
        error: "Export returned JSON but no translation href",
        data: initialData,
      },
      { status: 500 }
    );
  }

  let statusData: UnknownRecord = initialData;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const state = getStringField(statusData, ["requestState"]);

    if (state === "DONE" || state === "FAILED") {
      break;
    }

    await sleep(1000);
    statusData = await getTranslationStatus(translationHref, accessToken);
  }

  const finalState = getStringField(statusData, ["requestState"]);

  if (finalState !== "DONE") {
    return NextResponse.json({
      endpoint: exportEndpoint,
      status: 202,
      ok: false,
      message: "Translation is still not done. Click Load Assembly Geometry again.",
      translationHref,
      translationId,
      requestState: finalState,
      data: statusData,
    });
  }

  const resultExternalDataIds = getStringArrayField(statusData, [
    "resultExternalDataIds",
  ]);

  const externalDataId =
    resultExternalDataIds[0] ||
    getStringField(statusData, ["resultExternalDataId"]);

  if (!externalDataId) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        status: 500,
        ok: false,
        error: "Translation is DONE, but no resultExternalDataId was found.",
        data: statusData,
      },
      { status: 500 }
    );
  }

  const resultDocumentId =
    getStringField(statusData, ["resultDocumentId", "documentId"]) || documentId;

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
    const errorData = await parseResponse(downloadRes);

    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        translationHref,
        downloadEndpoint,
        status: downloadRes.status,
        ok: false,
        error: "Failed to download translated external data.",
        details: errorData,
      },
      { status: downloadRes.status }
    );
  }

  const downloadedBuffer = await downloadRes.arrayBuffer();

  if (isZip(downloadedBuffer)) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        translationHref,
        downloadEndpoint,
        status: 415,
        ok: false,
        fileKind: "zip",
        contentType: downloadContentType,
        error:
          "Downloaded translation result is a ZIP package, not a direct GLB. Do not pass it to GLTFLoader.",
        next:
          "Next step is to unzip it and serve the contained .gltf/.bin/textures, or convert package to GLB.",
      },
      { status: 415 }
    );
  }

  if (!isGlb(downloadedBuffer)) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        translationHref,
        downloadEndpoint,
        status: 415,
        ok: false,
        fileKind: "unknown-binary",
        contentType: downloadContentType,
        firstBytes: Array.from(new Uint8Array(downloadedBuffer.slice(0, 12))),
        error: "Downloaded result was not ZIP and not GLB.",
      },
      { status: 415 }
    );
  }

  return new NextResponse(downloadedBuffer, {
    status: 200,
    headers: {
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "no-store",
      "X-FuzzyCAD-Translation-Id": translationId || "",
      "X-FuzzyCAD-External-Data-Id": externalDataId,
    },
  });
}