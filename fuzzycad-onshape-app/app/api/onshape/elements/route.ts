import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId) {
    return NextResponse.json(
      { error: "Missing documentId or workspaceId" },
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

  const endpoint = `${server}/api/documents/d/${documentId}/w/${workspaceId}/elements`;

  const onshapeRes = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await onshapeRes.text();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return NextResponse.json(
    {
      endpoint,
      status: onshapeRes.status,
      ok: onshapeRes.ok,
      data,
    },
    { status: onshapeRes.ok ? 200 : onshapeRes.status }
  );
}