import { NextRequest, NextResponse } from "next/server";

async function parseErrorResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return res.json();
  }

  return res.text();
}

function isZip(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isGlb(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer);
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 && // g
    bytes[1] === 0x6c && // l
    bytes[2] === 0x54 && // T
    bytes[3] === 0x46 // F
  );
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
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "model/gltf-binary, application/octet-stream",
    },
  });

  const contentType = exportRes.headers.get("content-type") || "";

  if (!exportRes.ok) {
    const errorData = await parseErrorResponse(exportRes);

    return NextResponse.json(
      {
        endpoint,
        status: exportRes.status,
        ok: false,
        contentType,
        error: "Failed to synchronously export assembly glTF/GLB",
        details: errorData,
      },
      { status: exportRes.status }
    );
  }

  const arrayBuffer = await exportRes.arrayBuffer();

  if (isZip(arrayBuffer)) {
    return NextResponse.json(
      {
        endpoint,
        status: 200,
        ok: false,
        contentType,
        fileKind: "zip",
        error:
          "Onshape returned a ZIP package, not a directly loadable GLB. This causes the PK unexpected-token error in GLTFLoader.",
        next:
          "Either use a GLB/single-file export option if available, or add ZIP extraction and load the .gltf/.bin files inside.",
      },
      { status: 415 }
    );
  }

  if (!isGlb(arrayBuffer)) {
    return NextResponse.json(
      {
        endpoint,
        status: 200,
        ok: false,
        contentType,
        fileKind: "unknown",
        firstBytes: Array.from(new Uint8Array(arrayBuffer.slice(0, 12))),
        error:
          "Export did not return a GLB file. Expected first bytes to be glTF.",
      },
      { status: 415 }
    );
  }

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "no-store",
    },
  });
}