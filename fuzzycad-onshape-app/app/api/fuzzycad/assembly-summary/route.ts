import { NextRequest, NextResponse } from "next/server";

type UnknownRecord = Record<string, unknown>;

type AssemblyOccurrence = {
  path?: string[];
  transform?: number[];
  fixed?: boolean;
  hidden?: boolean;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getRootAssembly(data: unknown): UnknownRecord {
  if (!isRecord(data)) return {};
  const rootAssembly = data.rootAssembly;
  return isRecord(rootAssembly) ? rootAssembly : {};
}

function summarizeOccurrences(rootAssembly: UnknownRecord) {
  const occurrences = asArray(rootAssembly.occurrences) as AssemblyOccurrence[];

  return occurrences.slice(0, 30).map((occurrence, index) => {
    const transform = Array.isArray(occurrence.transform)
      ? occurrence.transform
      : [];

    return {
      index,
      path: occurrence.path ?? [],
      fixed: Boolean(occurrence.fixed),
      hidden: Boolean(occurrence.hidden),
      translation:
        transform.length === 16
          ? {
              x: transform[3],
              y: transform[7],
              z: transform[11],
            }
          : null,
      transform,
    };
  });
}

function summarizeFeatures(rootAssembly: UnknownRecord) {
  const features = asArray(rootAssembly.features);

  return features.slice(0, 80).map((feature, index) => {
    if (!isRecord(feature)) {
      return { index, rawType: typeof feature };
    }

    return {
      index,
      id: feature.id ?? feature.featureId ?? null,
      name: feature.name ?? feature.featureName ?? null,
      type: feature.type ?? feature.featureType ?? feature.messageType ?? null,
      suppressed: feature.suppressed ?? null,
    };
  });
}

function summarizeInstances(rootAssembly: UnknownRecord) {
  const instances = asArray(rootAssembly.instances);

  return instances.slice(0, 80).map((instance, index) => {
    if (!isRecord(instance)) {
      return { index, rawType: typeof instance };
    }

    return {
      index,
      id: instance.id ?? null,
      name: instance.name ?? null,
      type: instance.type ?? instance.instanceType ?? null,
      elementId: instance.elementId ?? null,
      documentId: instance.documentId ?? null,
      partId: instance.partId ?? null,
      configuration: instance.configuration ?? null,
      suppressed: instance.suppressed ?? null,
    };
  });
}

function getCount(rootAssembly: UnknownRecord, key: string): number {
  return asArray(rootAssembly[key]).length;
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

  const endpoint = `${server}/api/assemblies/d/${documentId}/w/${workspaceId}/e/${assemblyElementId}`;

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

  if (!onshapeRes.ok) {
    return NextResponse.json(
      {
        endpoint,
        status: onshapeRes.status,
        ok: false,
        data,
      },
      { status: onshapeRes.status }
    );
  }

  const rootAssembly = getRootAssembly(data);

  const summary = {
    endpoint,
    counts: {
      occurrences: getCount(rootAssembly, "occurrences"),
      instances: getCount(rootAssembly, "instances"),
      features: getCount(rootAssembly, "features"),
      patterns: getCount(rootAssembly, "patterns"),
      subAssemblies: getCount(rootAssembly, "subAssemblies"),
    },
    occurrencesPreview: summarizeOccurrences(rootAssembly),
    instancesPreview: summarizeInstances(rootAssembly),
    featuresPreview: summarizeFeatures(rootAssembly),
  };

  return NextResponse.json(summary);
}