import { NextRequest, NextResponse } from "next/server";

type UnknownRecord = Record<string, unknown>;

type OccurrenceNode = {
  occurrenceId: string;
  path: string[];
  pathKey: string;
  fixed: boolean;
  hidden: boolean;
  transform: number[] | null;
  translation: {
    x: number;
    y: number;
    z: number;
  } | null;
  rotationBasis: {
    xAxis: number[];
    yAxis: number[];
    zAxis: number[];
  } | null;
  likelyInstanceId: string | null;
};

type InstanceNode = {
  instanceId: string;
  name: string | null;
  type: string | null;
  sourceDocumentId: string | null;
  sourceElementId: string | null;
  sourcePartId: string | null;
  configuration: unknown;
  raw: UnknownRecord;
};

type SameSourceGroup = {
  sourceKey: string;
  sourceDocumentId: string | null;
  sourceElementId: string | null;
  sourcePartId: string | null;
  instanceCount: number;
  instances: {
    instanceId: string;
    name: string | null;
    type: string | null;
  }[];
};

type FeatureNode = {
  index: number;
  id: string | null;
  name: string | null;
  type: string | null;
  suppressed: boolean | null;
  looksLikeMateOrRelation: boolean;
  rawKeys: string[];
};

type FuzzyCADRelationshipGraph = {
  graphVersion: string;
  assembly: {
    documentId: string;
    workspaceId: string;
    assemblyElementId: string;
    server: string;
  };
  counts: {
    occurrences: number;
    instances: number;
    features: number;
    sameSourceGroups: number;
  };
  occurrences: OccurrenceNode[];
  instances: InstanceNode[];
  sameSourceGroups: SameSourceGroup[];
  features: FeatureNode[];
  candidateOperations: {
    id: string;
    type: string;
    title: string;
    reason: string[];
    targetInstanceIds: string[];
    uncertaintyDOF: {
      kind: string;
      direction: string;
      range: {
        min: number;
        max: number;
        unit: string;
      };
    };
  }[];
  warnings: string[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!value.every((item) => typeof item === "number")) {
    return null;
  }

  return value;
}

function getRootAssembly(data: unknown): UnknownRecord {
  if (!isRecord(data)) {
    return {};
  }

  const rootAssembly = data.rootAssembly;
  return isRecord(rootAssembly) ? rootAssembly : {};
}

function getStringField(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function getBooleanField(record: UnknownRecord, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

function getTransformTranslation(transform: number[] | null) {
  if (!transform || transform.length !== 16) {
    return null;
  }

  // Onshape returns a 4x4 affine transform. For the matrix shape seen in the
  // assembly response, translation is in indices 3, 7, 11.
  return {
    x: transform[3],
    y: transform[7],
    z: transform[11],
  };
}

function getRotationBasis(transform: number[] | null) {
  if (!transform || transform.length !== 16) {
    return null;
  }

  return {
    xAxis: [transform[0], transform[4], transform[8]],
    yAxis: [transform[1], transform[5], transform[9]],
    zAxis: [transform[2], transform[6], transform[10]],
  };
}

function normalizeOccurrencePath(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function buildOccurrences(rootAssembly: UnknownRecord): OccurrenceNode[] {
  const occurrences = asArray(rootAssembly.occurrences);

  return occurrences.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const path = normalizeOccurrencePath(record.path);
    const transform = asNumberArray(record.transform);

    return {
      occurrenceId: `occurrence-${index}`,
      path,
      pathKey: path.join("/"),
      fixed: Boolean(record.fixed),
      hidden: Boolean(record.hidden),
      transform,
      translation: getTransformTranslation(transform),
      rotationBasis: getRotationBasis(transform),
      likelyInstanceId: path.length > 0 ? path[path.length - 1] : null,
    };
  });
}

function buildInstances(rootAssembly: UnknownRecord): InstanceNode[] {
  const instances = asArray(rootAssembly.instances);

  return instances.map((item, index) => {
    const record = isRecord(item) ? item : {};

    const instanceId =
      getStringField(record, ["id", "instanceId", "nodeId"]) ??
      `instance-${index}`;

    return {
      instanceId,
      name: getStringField(record, ["name", "instanceName", "partName"]),
      type: getStringField(record, ["type", "instanceType"]),
      sourceDocumentId: getStringField(record, [
        "documentId",
        "sourceDocumentId",
        "documentVersion",
      ]),
      sourceElementId: getStringField(record, [
        "elementId",
        "sourceElementId",
      ]),
      sourcePartId: getStringField(record, [
        "partId",
        "sourcePartId",
        "bodyId",
      ]),
      configuration: record.configuration ?? null,
      raw: record,
    };
  });
}

function sourceKeyForInstance(instance: InstanceNode): string {
  const documentId = instance.sourceDocumentId ?? "unknownDocument";
  const elementId = instance.sourceElementId ?? "unknownElement";
  const partId = instance.sourcePartId ?? "unknownPart";

  return `${documentId}:${elementId}:${partId}`;
}

function buildSameSourceGroups(instances: InstanceNode[]): SameSourceGroup[] {
  const groups = new Map<string, InstanceNode[]>();

  for (const instance of instances) {
    const key = sourceKeyForInstance(instance);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)?.push(instance);
  }

  return Array.from(groups.entries())
    .map(([sourceKey, groupInstances]) => {
      const first = groupInstances[0];

      return {
        sourceKey,
        sourceDocumentId: first?.sourceDocumentId ?? null,
        sourceElementId: first?.sourceElementId ?? null,
        sourcePartId: first?.sourcePartId ?? null,
        instanceCount: groupInstances.length,
        instances: groupInstances.map((instance) => ({
          instanceId: instance.instanceId,
          name: instance.name,
          type: instance.type,
        })),
      };
    })
    .filter((group) => group.instanceCount > 1);
}

function looksLikeMateOrRelation(feature: UnknownRecord): boolean {
  const type = getStringField(feature, [
    "type",
    "featureType",
    "messageType",
    "featureTypeName",
  ]);

  const name = getStringField(feature, ["name", "featureName"]);

  const combined = `${type ?? ""} ${name ?? ""}`.toLowerCase();

  return (
    combined.includes("mate") ||
    combined.includes("relation") ||
    combined.includes("fastened") ||
    combined.includes("revolute") ||
    combined.includes("slider") ||
    combined.includes("cylindrical") ||
    combined.includes("planar") ||
    combined.includes("ball") ||
    combined.includes("parallel") ||
    combined.includes("gear") ||
    combined.includes("rack")
  );
}

function buildFeatures(rootAssembly: UnknownRecord): FeatureNode[] {
  const features = asArray(rootAssembly.features);

  return features.map((item, index) => {
    const record = isRecord(item) ? item : {};

    return {
      index,
      id: getStringField(record, ["id", "featureId", "nodeId"]),
      name: getStringField(record, ["name", "featureName"]),
      type: getStringField(record, [
        "type",
        "featureType",
        "messageType",
        "featureTypeName",
      ]),
      suppressed: getBooleanField(record, ["suppressed", "isSuppressed"]),
      looksLikeMateOrRelation: looksLikeMateOrRelation(record),
      rawKeys: Object.keys(record),
    };
  });
}

function buildCandidateOperations(
  sameSourceGroups: SameSourceGroup[]
): FuzzyCADRelationshipGraph["candidateOperations"] {
  return sameSourceGroups.slice(0, 10).map((group, index) => ({
    id: `candidate-shared-range-${index}`,
    type: "same_source_shared_uncertainty",
    title: `Repeated component group with ${group.instanceCount} instances`,
    reason: [
      "These instances appear to reference the same source document / element / part identity.",
      "Repeated source components are likely candidates for grouped uncertainty operations.",
      "A later version should check transforms, mate relations, and user selection before confirming the operation scope.",
    ],
    targetInstanceIds: group.instances.map((instance) => instance.instanceId),
    uncertaintyDOF: {
      kind: "linear_or_dimensional_range",
      direction: "unknown_until_user_selects_operation",
      range: {
        min: 0,
        max: 30,
        unit: "mm",
      },
    },
  }));
}

function buildWarnings(rootAssembly: UnknownRecord, instances: InstanceNode[]) {
  const warnings: string[] = [];

  if (asArray(rootAssembly.occurrences).length === 0) {
    warnings.push("No rootAssembly.occurrences found.");
  }

  if (instances.length === 0) {
    warnings.push(
      "No rootAssembly.instances found. This assembly response may encode instance details elsewhere, so the parser needs adjustment."
    );
  }

  const missingSourceCount = instances.filter(
    (instance) =>
      !instance.sourceDocumentId &&
      !instance.sourceElementId &&
      !instance.sourcePartId
  ).length;

  if (missingSourceCount > 0) {
    warnings.push(
      `${missingSourceCount} instances do not expose source document / element / part IDs in the expected fields. Inspect raw instance keys.`
    );
  }

  warnings.push(
    "This is a read-only FuzzyCAD graph. It does not modify Onshape geometry yet."
  );

  return warnings;
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
  const occurrences = buildOccurrences(rootAssembly);
  const instances = buildInstances(rootAssembly);
  const sameSourceGroups = buildSameSourceGroups(instances);
  const features = buildFeatures(rootAssembly);

  const graph: FuzzyCADRelationshipGraph = {
    graphVersion: "0.1.0",
    assembly: {
      documentId,
      workspaceId,
      assemblyElementId,
      server,
    },
    counts: {
      occurrences: occurrences.length,
      instances: instances.length,
      features: features.length,
      sameSourceGroups: sameSourceGroups.length,
    },
    occurrences,
    instances,
    sameSourceGroups,
    features,
    candidateOperations: buildCandidateOperations(sameSourceGroups),
    warnings: buildWarnings(rootAssembly, instances),
  };

  return NextResponse.json({
    endpoint,
    status: 200,
    ok: true,
    graph,
  });
}