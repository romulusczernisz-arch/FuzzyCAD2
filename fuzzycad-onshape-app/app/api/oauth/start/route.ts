import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
  const oauthUrl = process.env.ONSHAPE_OAUTH_URL || "https://oauth.onshape.com";

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Missing ONSHAPE_CLIENT_ID or ONSHAPE_REDIRECT_URI" },
      { status: 500 }
    );
  }

  const documentId = req.nextUrl.searchParams.get("documentId") || "";
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") || "";
  const elementId = req.nextUrl.searchParams.get("elementId") || "";
  const server =
    req.nextUrl.searchParams.get("server") || "https://cad.onshape.com";

  const state = Buffer.from(
    JSON.stringify({ documentId, workspaceId, elementId, server })
  ).toString("base64url");

  const url = new URL(`${oauthUrl}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}