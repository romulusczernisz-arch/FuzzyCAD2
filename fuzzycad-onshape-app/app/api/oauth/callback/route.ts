import { NextRequest, NextResponse } from "next/server";

type OAuthState = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
  server?: string;
};

function decodeState(state: string | null): OAuthState {
  if (!state) {
    return {};
  }

  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
  const oauthUrl = process.env.ONSHAPE_OAUTH_URL || "https://oauth.onshape.com";

  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code" }, { status: 400 });
  }

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        error:
          "Missing ONSHAPE_CLIENT_ID, ONSHAPE_CLIENT_SECRET, or ONSHAPE_REDIRECT_URI",
      },
      { status: 500 }
    );
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const tokenRes = await fetch(`${oauthUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json(
      {
        error: "Failed to exchange OAuth code for token",
        status: tokenRes.status,
        details: tokenData,
      },
      { status: tokenRes.status }
    );
  }

  const parsedState = decodeState(state);

  const redirectBack = new URL("/", req.nextUrl.origin);

  if (parsedState.documentId) {
    redirectBack.searchParams.set("documentId", parsedState.documentId);
  }

  if (parsedState.workspaceId) {
    redirectBack.searchParams.set("workspaceId", parsedState.workspaceId);
  }

  if (parsedState.elementId) {
    redirectBack.searchParams.set("elementId", parsedState.elementId);
  }

  if (parsedState.server) {
    redirectBack.searchParams.set("server", parsedState.server);
  }

  redirectBack.searchParams.set("oauth", "connected");

  const response = NextResponse.redirect(redirectBack);

  response.cookies.set("onshape_access_token", tokenData.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: tokenData.expires_in || 3600,
  });

  if (tokenData.refresh_token) {
    response.cookies.set("onshape_refresh_token", tokenData.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}