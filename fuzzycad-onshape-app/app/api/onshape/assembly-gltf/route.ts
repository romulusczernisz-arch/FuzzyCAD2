import { NextRequest, NextResponse } from "next/server";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

async function parseResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return res.json();
  }

  return res.text();
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

  const endpoint = `${server}/api/assemblies/d/${documentId}/w/${workspaceId}/e/${assemblyElementId}/export/gltf`;

  const exportRes = await fetch(endpoint, {
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

  const contentType = exportRes.headers.get("content-type") || "";

  if (!exportRes.ok) {
    const errorData = await parseResponse(exportRes);

    return NextResponse.json(
      {
        endpoint,
        status: exportRes.status,
        ok: false,
        contentType,
        error: "Failed to export assembly glTF",
        details: errorData,
      },
      { status: exportRes.status }
    );
  }

  if (
    contentType.includes("model/gltf-binary") ||
    contentType.includes("model/gltf+json") ||
    contentType.includes("application/octet-stream")
  ) {
    const arrayBuffer = await exportRes.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType || "model/gltf-binary",
        "Cache-Control": "no-store",
      },
    });
  }

  const data = await parseResponse(exportRes);

  if (!isRecord(data)) {
    return NextResponse.json(
      {
        endpoint,
        status: exportRes.status,
        ok: false,
        contentType,
        error: "Unexpected glTF export response",
        details: data,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    endpoint,
    status: exportRes.status,
    ok: true,
    contentType,
    message:
      "Onshape returned JSON instead of a direct glTF/GLB file. We need to inspect this response and possibly add translation polling/download.",
    data,
  });
}