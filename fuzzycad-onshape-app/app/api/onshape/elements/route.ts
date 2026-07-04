import { NextRequest, NextResponse } from "next/server";
import {
  getCachedElements,
} from "../../../lib/server/onshapeElementsCache";
import { shouldForceRefresh } from "../../../lib/server/onshapeApi";

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
      {
        error: "Not connected to Onshape yet",
        action: "Click Connect Onshape first",
      },
      { status: 401 },
    );
  }

  const result = await getCachedElements({
    server,
    documentId,
    workspaceId,
    accessToken,
    route: "/api/onshape/elements",
    force,
  });

  return NextResponse.json(
    {
      endpoint: result.endpoint,
      status: result.status,
      ok: result.ok,
      cache: result.cache,
      data: result.data,
    },
    { status: result.ok ? 200 : result.status },
  );
}