import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");

  if (!documentId || !workspaceId) {
    return NextResponse.json(
      { error: "Missing documentId or workspaceId" },
      { status: 400 }
    );
  }

  // Temporary: no OAuth yet.
  // This route is only a placeholder until we add OAuth/API authentication.
  return NextResponse.json({
    message: "Ready to call Onshape elements API",
    nextEndpoint: `${server}/api/documents/d/${documentId}/w/${workspaceId}/elements`,
    documentId,
    workspaceId,
  });
}