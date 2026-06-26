import { NextRequest, NextResponse } from "next/server";

type OccurrenceUpdate = {
  path: string[];
  transform: number[];
};

type RequestBody = {
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  server?: string;
  occurrences: OccurrenceUpdate[];
};

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 }
    );
  }

  let body: RequestBody;

  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    documentId,
    workspaceId,
    assemblyElementId,
    server = "https://cad.onshape.com",
    occurrences,
  } = body;

  if (!documentId || !workspaceId || !assemblyElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or assemblyElementId" },
      { status: 400 }
    );
  }

  if (!Array.isArray(occurrences) || occurrences.length === 0) {
    return NextResponse.json(
      { error: "occurrences must be a non-empty array" },
      { status: 400 }
    );
  }

  const endpoint = `${server}/api/assemblies/d/${documentId}/w/${workspaceId}/e/${assemblyElementId}/occurrencetransforms`;

  // Transforms are absolute (computed from current placement + delta).
  const payload = {
    isRelative: false,
    occurrences,
  };

  const onshapeRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await onshapeRes.text();

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return NextResponse.json(
    { endpoint, status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: onshapeRes.ok ? 200 : onshapeRes.status }
  );
}
