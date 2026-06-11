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
  contextPath: string;
  rawKeys: string[];
  raw: UnknownRecord;
};

type AssemblyBlock = {
  contextPath: string;
  keys: string[];
  occurrenceCount: number;
  instanceCount: number;
  featureCount: number;
  subAssemblyCount: number;
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
    contextPath: string;
  }[];
};

type FeatureNode = {
  index: number;
  contextPath: string;
  id: string | null;
  name: string | null;
  type: string | null;
  suppressed: boolean | null;
  looksLikeMateOrRelation: boolean;
  rawKeys: string[];
};

type PathMatch = {
  occurrencePathKey: string;
  likelyInstanceId: string | null;
  matchedInstance: {
    instanceId: string;
    name: string | null;
    type: string | null;
    sourceKey: string;
    contextPath: string;
  } | null;
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
    assemblyBlocks: number;
    sameSourceGroups: number;
    pathMatches: number;
  };
  assemblyBlocks: AssemblyBlock[];
  occurrences: OccurrenceNode[];
  instances: InstanceNode[];
  pathMatches: PathMatch[];
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
  debug: {
    rootAssemblyKeys: string[];
    firstInstanceRawKeys: string[];
    firstFeatureRawKeys: string[];
    firstAssemblyBlockKeys: string[];
  };
  warnings: string[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function looksAssemblyLike(record: UnknownRecord): boolean {
  return (
    Array.isArray(record.occurrences) ||
    Array.isArray(record.instances) ||
    Array.isArray(record.features) ||
    Array.isArray(record.subAssemblies) ||
    Array.isArray(record.subassemblies)
  );
}

function findAssemblyBlocks(root: unknown): { path: string; record: UnknownRecord }[] {
  const results: { path: string; record: UnknownRecord }[] = [];
  const visited = new Set<unknown>();

  function visit(value: unknown, path: string) {
    if (!isRecord(value) && !Array.isArray(value)) {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    if (isRecord(value) && looksAssemblyLike(value)) {
      results.push({ path, record: value });
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (isRecord(child) || Array.isArray(child)) {
        visit(child, path ? `${path}.${key}` : key);
      }
    }
  }

  visit(root, "rootAssembly");

  return results;
}

function buildAssemblyBlocks(blocks: { path: string; record: UnknownRecord }[]): AssemblyBlock[] {
  return blocks.map((block) => ({
    contextPath: block.path,
    keys: Object.keys(block.record),
    occurrenceCount: asArray(block.record.occurrences).length,
    instanceCount: asArray(block.record.instances).length,
    featureCount: asArray(block.record.features).length,
    subAssemblyCount:
      asArray(block.record.subAssemblies).length +
      asArray(block.record.subassemblies).length,
  }));
}

function buildOccurrences(blocks: { path: string; record: UnknownRecord }[]): OccurrenceNode[] {
  const occurrences: OccurrenceNode[] = [];

  for (const block of blocks) {
    const blockOccurrences = asArray(block.record.occurrences);

    blockOccurrences.forEach((item, index) => {
      const record = isRecord(item) ? item : {};
      const path = normalizeOccurrencePath(record.path);
      const transform = asNumberArray(record.transform);
      const globalIndex = occurrences.length;

      occurrences.push({
        occurrenceId: `occurrence-${globalIndex}`,
        path,
        pathKey: path.join("/"),
        fixed: Boolean(record.fixed),
        hidden: Boolean(record.hidden),
        transform,
        translation: getTransformTranslation(transform),
        rotationBasis: getRotationBasis(transform),
        likelyInstanceId: path.length > 0 ? path[path.length - 1] : null,
      });
    });
  }

  return occurrences;
}

function buildInstances(blocks: { path: string; record: UnknownRecord }[]): InstanceNode[] {
  const instances: InstanceNode[] = [];

  for (const block of blocks) {
    const blockInstances = asArray(block.record.instances);

    blockInstances.forEach((item, index) => {
      const record = isRecord(item) ? item : {};

      const instanceId =
        getStringField(record, [
          "id",
          "instanceId",
          "nodeId",
          "occurrenceId",
          "partId",
        ]) ?? `instance-${instances.length}`;

      instances.push({
        instanceId,
        name: getStringField(record, [
          "name",
          "instanceName",
          "partName",
          "elementName",
        ]),
        type: getStringField(record, [
          "type",
          "instanceType",
          "elementType",
          "partType",
        ]),
        sourceDocumentId: getStringField(record, [
          "documentId",
          "sourceDocumentId",
          "documentMicroversionId",
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
          "partStudioId",
        ]),
        configuration: record.configuration ?? null,
        contextPath: `${block.path}.instances[${index}]`,
        rawKeys: Object.keys(record),
        raw: record,
      });
    });
  }

  return instances;
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

    if (key === "unknownDocument:unknownElement:unknownPart") {
      continue;
    }

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
          contextPath: instance.contextPath,
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

function buildFeatures(blocks: { path: string; record: UnknownRecord }[]): FeatureNode[] {
  const features: FeatureNode[] = [];

  for (const block of blocks) {
    const blockFeatures = asArray(block.record.features);

    blockFeatures.forEach((item) => {
      const record = isRecord(item) ? item : {};

      features.push({
        index: features.length,
        contextPath: `${block.path}.features[${features.length}]`,
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
      });
    });
  }

  return features;
}

function buildPathMatches(
  occurrences: OccurrenceNode[],
  instances: InstanceNode[]
): PathMatch[] {
  const instanceById = new Map<string, InstanceNode>();

  for (const instance of instances) {
    instanceById.set(instance.instanceId, instance);
  }

  return occurrences.map((occurrence) => {
    const likelyInstanceId = occurrence.likelyInstanceId;
    const matched = likelyInstanceId ? instanceById.get(likelyInstanceId) : null;

    return {
      occurrencePathKey: occurrence.pathKey,
      likelyInstanceId,
      matchedInstance: matched
        ? {
            instanceId: matched.instanceId,
            name: matched.name,
            type: matched.type,
            sourceKey: sourceKeyForInstance(matched),
            contextPath: matched.contextPath,
          }
        : null,
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
      "These instances reference the same source document / element / part identity.",
      "Repeated source components are likely candidates for grouped uncertainty operations.",
      "A later version should also check transforms, mate relations, and user selection before confirming operation scope.",
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

function buildWarnings(
  rootAssembly: UnknownRecord,
  occurrences: OccurrenceNode[],
  instances: InstanceNode[],
  pathMatches: PathMatch[],
  sameSourceGroups: SameSourceGroup[],
  features: FeatureNode[]
) {
  const warnings: string[] = [];

  if (occurrences.length === 0) {
    warnings.push("No occurrences found anywhere in the assembly JSON.");
  }

  if (instances.length === 0) {
    warnings.push(
      "No instances found anywhere in the assembly JSON. The parser may need to inspect additional Onshape fields."
    );
  }

  const unmatchedOccurrences = pathMatches.filter(
    (match) => !match.matchedInstance
  ).length;

  if (unmatchedOccurrences > 0) {
    warnings.push(
      `${unmatchedOccurrences} occurrences could not be matched to parsed instance IDs. This is expected for nested assemblies until we fully decode occurrence paths.`
    );
  }

  const unknownSourceCount = instances.filter(
    (instance) => sourceKeyForInstance(instance) === "unknownDocument:unknownElement:unknownPart"
  ).length;

  if (unknownSourceCount > 0) {
    warnings.push(
      `${unknownSourceCount} instances do not expose source document / element / part IDs in the expected fields. Inspect their rawKeys/raw fields.`
    );
  }

  if (sameSourceGroups.length === 0) {
    warnings.push(
      "No same-source repeated groups were detected yet. This may mean source fields are named differently or repeated parts are inside nested occurrence paths."
    );
  }

  if (features.length === 0) {
    warnings.push(
      "No assembly features were found in parsed assembly blocks. Mates may be encoded elsewhere or require a separate API endpoint."
    );
  }

  warnings.push(
    "This is still a read-only FuzzyCAD graph. It does not modify Onshape geometry."
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
  const assemblyBlocks = findAssemblyBlocks(rootAssembly);
  const assemblyBlockSummaries = buildAssemblyBlocks(assemblyBlocks);

  const occurrences = buildOccurrences(assemblyBlocks);
  const instances = buildInstances(assemblyBlocks);
  const pathMatches = buildPathMatches(occurrences, instances);
  const sameSourceGroups = buildSameSourceGroups(instances);
  const features = buildFeatures(assemblyBlocks);

  const graph: FuzzyCADRelationshipGraph = {
    graphVersion: "0.2.0",
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
      assemblyBlocks: assemblyBlocks.length,
      sameSourceGroups: sameSourceGroups.length,
      pathMatches: pathMatches.filter((match) => match.matchedInstance).length,
    },
    assemblyBlocks: assemblyBlockSummaries,
    occurrences,
    instances,
    pathMatches,
    sameSourceGroups,
    features,
    candidateOperations: buildCandidateOperations(sameSourceGroups),
    debug: {
      rootAssemblyKeys: Object.keys(rootAssembly),
      firstInstanceRawKeys: instances[0]?.rawKeys ?? [],
      firstFeatureRawKeys: features[0]?.rawKeys ?? [],
      firstAssemblyBlockKeys: assemblyBlockSummaries[0]?.keys ?? [],
    },
    warnings: buildWarnings(
      rootAssembly,
      occurrences,
      instances,
      pathMatches,
      sameSourceGroups,
      features
    ),
  };

  return NextResponse.json({
    endpoint,
    status: 200,
    ok: true,
    graph,
  });
}