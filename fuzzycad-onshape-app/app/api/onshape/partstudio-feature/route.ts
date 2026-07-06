import { NextRequest, NextResponse } from "next/server";

// ── Types ──────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type UncertaintyDirection = "POSITIVE" | "NEGATIVE" | "BOTH";

export type FuzzyCADFeatureParams = {
  // Bounding box center in Onshape world coordinates (meters)
  centerX: number;
  centerY: number;
  centerZ: number;
  // Bounding box half-extents (meters, positive)
  halfX: number;
  halfY: number;
  halfZ: number;
  // Confidence per axis
  confidenceX: ConfidenceLevel;
  confidenceY: ConfidenceLevel;
  confidenceZ: ConfidenceLevel;
  // Uncertainty direction per axis
  directionX: UncertaintyDirection;
  directionY: UncertaintyDirection;
  directionZ: UncertaintyDirection;
  // Annotation text
  comment: string;
  // The annotation ID so we can find and delete/replace it later
  annotationId: string;
};

type AddFeatureBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  params: FuzzyCADFeatureParams;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function lengthParam(parameterId: string, valueMeters: number) {
  return {
    type: 151,
    typeName: "BTMParameterLength",
    message: {
      parameterId,
      expression: `${valueMeters} m`,
      value: valueMeters,
      units: "METER",
    },
  };
}

function enumParam(parameterId: string, value: string) {
  return {
    type: 145,
    typeName: "BTMParameterEnum",
    message: {
      parameterId,
      value,
    },
  };
}

function stringParam(parameterId: string, value: string) {
  return {
    type: 149,
    typeName: "BTMParameterString",
    message: {
      parameterId,
      value,
    },
  };
}

function buildFeature(params: FuzzyCADFeatureParams) {
  return {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType: "fuzzyCADUncertaintyShell",
      name: `FuzzyCAD: ${params.comment || params.annotationId}`,
      parameters: [
        lengthParam("centerX", params.centerX),
        lengthParam("centerY", params.centerY),
        lengthParam("centerZ", params.centerZ),
        lengthParam("halfX", params.halfX),
        lengthParam("halfY", params.halfY),
        lengthParam("halfZ", params.halfZ),
        enumParam("confidenceX", params.confidenceX),
        enumParam("confidenceY", params.confidenceY),
        enumParam("confidenceZ", params.confidenceZ),
        enumParam("directionX", params.directionX),
        enumParam("directionY", params.directionY),
        enumParam("directionZ", params.directionZ),
        stringParam("comment", params.comment),
        // Store annotationId in the comment field suffix so we can match on reload
        stringParam("annotationId", params.annotationId),
      ],
    },
  };
}

// ── Route handlers ─────────────────────────────────────────────────────────

/** POST — add (or replace) a FuzzyCAD uncertainty shell feature in a Part Studio */
export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape" },
      { status: 401 }
    );
  }

  let body: AddFeatureBody;
  try {
    body = (await req.json()) as AddFeatureBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    documentId,
    workspaceId,
    partStudioElementId,
    server = "https://cad.onshape.com",
    params,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or partStudioElementId" },
      { status: 400 }
    );
  }

  const base = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}`;

  // ── Step 1: list existing features to find any with the same annotationId ──
  const listRes = await fetch(`${base}/features`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  let existingFeatureId: string | null = null;

  if (listRes.ok) {
    type Feature = {
      message?: {
        featureId?: string;
        name?: string;
        parameters?: Array<{ message?: { parameterId?: string; value?: string } }>;
      };
    };
    const listData = (await listRes.json()) as { features?: Feature[] };
    const features = listData.features ?? [];

    for (const f of features) {
      const msg = f.message;
      if (!msg || msg.name?.startsWith("FuzzyCAD: ") === false) continue;
      const idParam = (msg.parameters ?? []).find(
        (p) => p.message?.parameterId === "annotationId"
      );
      if (idParam?.message?.value === params.annotationId) {
        existingFeatureId = msg.featureId ?? null;
        break;
      }
    }
  }

  const feature = buildFeature(params);

  // ── Step 2: update if exists, otherwise add ────────────────────────────
  let onshapeRes: Response;

  if (existingFeatureId) {
    onshapeRes = await fetch(`${base}/features/featureid/${existingFeatureId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ feature }),
    });
  } else {
    onshapeRes = await fetch(`${base}/features`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ feature }),
    });
  }

  const text = await onshapeRes.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  return NextResponse.json(
    { status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: onshapeRes.ok ? 200 : onshapeRes.status }
  );
}

/** GET — list all FuzzyCAD annotation features from a Part Studio */
export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "Not connected to Onshape" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams;
  const documentId = p.get("documentId");
  const workspaceId = p.get("workspaceId");
  const partStudioElementId = p.get("partStudioElementId");
  const server = p.get("server") ?? "https://cad.onshape.com";

  if (!documentId || !workspaceId || !partStudioElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or partStudioElementId" },
      { status: 400 }
    );
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  const onshapeRes = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await onshapeRes.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  return NextResponse.json(
    { status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: onshapeRes.ok ? 200 : onshapeRes.status }
  );
}
