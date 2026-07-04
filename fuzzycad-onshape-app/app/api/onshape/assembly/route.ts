import { NextRequest, NextResponse } from "next/server";
import {
  getCachedAssembly,
} from "../../../lib/server/onshapeAssemblyCache";
import { shouldForceRefresh } from "../../../lib/server/onshapeApi";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");
  const assemblyElementId = searchParams.get("assemblyElementId");
  const force = shouldForceRefresh(searchParams);

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !assemblyElementId) {
    return NextResponse.json(
      {
        error: "Missing documentId, workspaceId, or assemblyElementId",
      },
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

  const result = await getCachedAssembly({
    server,
    documentId,
    workspaceId,
    assemblyElementId,
    accessToken,
    route: "/api/onshape/assembly",
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