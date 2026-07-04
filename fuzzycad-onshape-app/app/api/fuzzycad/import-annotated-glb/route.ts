import { NextRequest, NextResponse } from "next/server";
import {
  onshapeFetch,
  parseJsonOrText,
} from "../../../lib/server/onshapeApi";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  server?: string;
  annotatedSelectionGlbElementId: string;
  destinationName?: string;
};

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet" },
      { status: 401 },
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
    server = "https://cad.onshape.com",
    annotatedSelectionGlbElementId,
    destinationName = "FuzzyCAD_Visualization_Layer",
  } = body;

  if (!documentId || !workspaceId || !annotatedSelectionGlbElementId) {
    return NextResponse.json(
      {
        error:
          "Missing documentId, workspaceId, or annotatedSelectionGlbElementId",
      },
      { status: 400 },
    );
  }

  /**
   * Probe:
   * Try translating the saved GLB blob into an Onshape document element.
   *
   * Important:
   * This is intentionally isolated from save-project.
   * We need to see whether Onshape accepts GLB as an import source.
   */
  const endpoint = `${server}/api/translations/d/${documentId}/w/${workspaceId}`;

  const payloadCandidates = [
    {
      name: "glb-format-name",
      body: {
        elementId: annotatedSelectionGlbElementId,
        formatName: "GLB",
        storeInDocument: true,
        destinationName,
      },
    },
    {
      name: "gltf-format-name",
      body: {
        elementId: annotatedSelectionGlbElementId,
        formatName: "GLTF",
        storeInDocument: true,
        destinationName,
      },
    },
  ];

  const attempts = [];

  for (const candidate of payloadCandidates) {
    const res = await onshapeFetch(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(candidate.body),
      },
      {
        route: "/api/fuzzycad/import-annotated-glb",
        operation: `create-translation-${candidate.name}`,
      },
    );

    const data = await parseJsonOrText(res);

    attempts.push({
      candidate: candidate.name,
      endpoint,
      requestBody: candidate.body,
      status: res.status,
      ok: res.ok,
      data,
    });

    if (res.ok) {
      return NextResponse.json({
        ok: true,
        mode: "translation-started",
        acceptedCandidate: candidate.name,
        endpoint,
        requestBody: candidate.body,
        status: res.status,
        data,
        attempts,
      });
    }
  }

  return NextResponse.json(
    {
      ok: false,
      mode: "translation-rejected",
      message:
        "Onshape did not accept the saved GLB as an import translation source. If this happens, we need to switch the generated artifact format or generate Onshape-native geometry.",
      attempts,
    },
    { status: 502 },
  );
}