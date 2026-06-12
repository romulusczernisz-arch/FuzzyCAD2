import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

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

function getMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".bin")) return "application/octet-stream";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".glb")) return "model/gltf-binary";

  return "application/octet-stream";
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index + 1) : "";
}

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") continue;

    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join("/");
}

function resolveGltfUri(gltfPath: string, uri: string): string {
  if (
    uri.startsWith("data:") ||
    uri.startsWith("http://") ||
    uri.startsWith("https://")
  ) {
    return uri;
  }

  const decoded = decodeURIComponent(uri);
  return normalizePath(`${dirname(gltfPath)}${decoded}`);
}

async function zipFileToDataUri(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(filePath);

  if (!file) {
    throw new Error(`Missing referenced glTF asset in ZIP: ${filePath}`);
  }

  const uint8 = await file.async("uint8array");
  const base64 = Buffer.from(uint8).toString("base64");
  const mime = getMimeType(filePath);

  return `data:${mime};base64,${base64}`;
}

async function unpackZipToLoadableGltf(
  arrayBuffer: ArrayBuffer
): Promise<NextResponse> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const fileNames = Object.keys(zip.files).filter(
    (name) => !zip.files[name].dir
  );

  const glbName = fileNames.find((name) => name.toLowerCase().endsWith(".glb"));

  if (glbName) {
    const glbBuffer = await zip.file(glbName)?.async("arraybuffer");

    if (!glbBuffer) {
      throw new Error(`Failed to read GLB from ZIP: ${glbName}`);
    }

    return new NextResponse(glbBuffer, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "no-store",
        "X-FuzzyCAD-Zip-Mode": "extracted-glb",
        "X-FuzzyCAD-Extracted-File": glbName,
      },
    });
  }

  const gltfName = fileNames.find((name) =>
    name.toLowerCase().endsWith(".gltf")
  );

  if (!gltfName) {
    return NextResponse.json(
      {
        ok: false,
        error: "ZIP did not contain a .glb or .gltf file.",
        files: fileNames,
      },
      { status: 415 }
    );
  }

  const gltfText = await zip.file(gltfName)?.async("string");

  if (!gltfText) {
    throw new Error(`Failed to read glTF from ZIP: ${gltfName}`);
  }

  const gltf = JSON.parse(gltfText) as UnknownRecord;

  const buffers = Array.isArray(gltf.buffers) ? gltf.buffers : [];
  for (const buffer of buffers) {
    if (!isRecord(buffer)) continue;

    const uri = getStringField(buffer, ["uri"]);
    if (!uri || uri.startsWith("data:")) continue;

    const resolved = resolveGltfUri(gltfName, uri);
    buffer.uri = await zipFileToDataUri(zip, resolved);
  }

  const images = Array.isArray(gltf.images) ? gltf.images : [];
  for (const image of images) {
    if (!isRecord(image)) continue;

    const uri = getStringField(image, ["uri"]);
    if (!uri || uri.startsWith("data:")) continue;

    const resolved = resolveGltfUri(gltfName, uri);
    image.uri = await zipFileToDataUri(zip, resolved);
  }

  const embeddedJson = JSON.stringify(gltf);

  return new NextResponse(embeddedJson, {
    status: 200,
    headers: {
      "Content-Type": "model/gltf+json",
      "Cache-Control": "no-store",
      "X-FuzzyCAD-Zip-Mode": "embedded-gltf",
      "X-FuzzyCAD-Extracted-File": gltfName,
    },
  });
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

  for (let attempt = 0; attempt < 20; attempt += 1) {
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
    try {
      return await unpackZipToLoadableGltf(downloadedBuffer);
    } catch (error) {
      return NextResponse.json(
        {
          endpoint: exportEndpoint,
          translationHref,
          downloadEndpoint,
          status: 500,
          ok: false,
          fileKind: "zip",
          contentType: downloadContentType,
          error: "Failed to unpack ZIP glTF package.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  }

  if (isGlb(downloadedBuffer)) {
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