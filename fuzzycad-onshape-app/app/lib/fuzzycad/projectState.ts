import type {
  FuzzyCADUncertaintyAnnotation,
  FuzzyCADUncertaintyDocument,
  FuzzyCADUncertaintySource,
} from "../uncertainty/document";
import type {
  AxialStretchObjectSummary,
  Vec3Tuple,
} from "../operations/axialStretchTypes";

export const FUZZYCAD_PROJECT_STATE_SCHEMA_VERSION =
  "fuzzycad.project.v1" as const;

export type FuzzyCADProjectStateV1 = {
  schemaVersion: typeof FUZZYCAD_PROJECT_STATE_SCHEMA_VERSION;

  project: {
    projectId: string;
    name: string;
    updatedAt: string;
  };

  source: FuzzyCADProjectStateSource;

  objectMap: Record<string, FuzzyCADObjectMapping>;

  annotations: FuzzyCADUncertaintyAnnotation[];

  generatedGeometry: FuzzyCADGeneratedGeometryState;
};

export type FuzzyCADProjectStateSource = {
  server: string;
  documentId: string | null;
  workspaceId: string | null;
  elementId: string | null;
  assemblyElementId: string | null;
  baseMicroversionId?: string | null;
};

export type FuzzyCADObjectMapping = {
  pathKey: string;
  occurrencePath: string[];
  instanceName?: string | null;

  aabbCenterWorld?: Vec3Tuple;
  aabbSizeWorld?: Vec3Tuple;
  aabbMinWorld?: Vec3Tuple;
  aabbMaxWorld?: Vec3Tuple;

  principalAxisWorld?: Vec3Tuple;
  axisLength?: number;
  crossSectionSize?: number;
};

export type FuzzyCADGeneratedGeometryMode =
  | "none"
  | "blob-mesh"
  | "featurescript"
  | "imported-partstudio";

export type FuzzyCADGeneratedGeometryState = {
  mode: FuzzyCADGeneratedGeometryMode;

  /**
   * This points to the Onshape blob / app / generated geometry container.
   * For now this will point to fuzzycad-generated-geometry.json.
   * Later it can point to a GLB, Part Studio, or FeatureScript-generated layer.
   */
  containerElementId?: string | null;

  /**
   * Later this can point to the occurrence path of the generated visualization
   * layer inside the target assembly.
   */
  assemblyOccurrencePath?: string[] | null;

  lastGeneratedAt?: string | null;

  manifest?: FuzzyCADGeneratedGeometryManifest | null;

  reconstruction?: unknown;
};

export type FuzzyCADGeneratedGeometryManifest = {
  visualObjects: FuzzyCADGeneratedVisualObject[];
};

export type FuzzyCADGeneratedVisualObject = {
  id: string;
  annotationId: string;
  kind:
    | "blur-shell"
    | "direction-arrow"
    | "dashed-line"
    | "placeholder-mesh"
    | "angle-rotated-part"
    | "bent-part";
  targetPathKeys: string[];
  axis?: "x" | "y" | "z";
  /** For angle-rotated-part: the target angle in degrees. */
  angleDeg?: number;
  /** For bent-part: the bend adjustment in degrees. */
  deltaDeg?: number;
};

export function createEmptyGeneratedGeometryState(): FuzzyCADGeneratedGeometryState {
  return {
    mode: "none",
    containerElementId: null,
    assemblyOccurrencePath: null,
    lastGeneratedAt: null,
    manifest: {
      visualObjects: [],
    },
  };
}

function normalizeSource(
  source: FuzzyCADUncertaintySource,
): FuzzyCADProjectStateSource {
  return {
    server: source.server,
    documentId: source.documentId,
    workspaceId: source.workspaceId,
    elementId: source.elementId,
    assemblyElementId: source.assemblyElementId,
  };
}

function makeProjectId(source: FuzzyCADProjectStateSource) {
  return [
    source.server,
    source.documentId ?? "no-document",
    source.workspaceId ?? "no-workspace",
    source.assemblyElementId ?? "no-assembly",
  ].join("|");
}

function pathKeyToOccurrencePath(pathKey: string) {
  return pathKey.split("/").filter((part) => part.length > 0);
}

function vecAdd(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vecSub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecScale(a: Vec3Tuple, scale: number): Vec3Tuple {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

export function buildObjectMap(
  objectSummaries: AxialStretchObjectSummary[],
): Record<string, FuzzyCADObjectMapping> {
  const objectMap: Record<string, FuzzyCADObjectMapping> = {};

  for (const summary of objectSummaries) {
    const halfSize = vecScale(summary.aabbSizeWorld, 0.5);

    objectMap[summary.pathKey] = {
      pathKey: summary.pathKey,
      occurrencePath: pathKeyToOccurrencePath(summary.pathKey),
      instanceName: summary.name,

      aabbCenterWorld: summary.aabbCenterWorld,
      aabbSizeWorld: summary.aabbSizeWorld,
      aabbMinWorld: vecSub(summary.aabbCenterWorld, halfSize),
      aabbMaxWorld: vecAdd(summary.aabbCenterWorld, halfSize),

      principalAxisWorld: summary.principalAxisWorld,
      axisLength: summary.axisLength,
      crossSectionSize: summary.crossSectionSize,
    };
  }

  return objectMap;
}

export function buildGeneratedGeometryManifest(
  annotations: FuzzyCADUncertaintyAnnotation[],
): FuzzyCADGeneratedGeometryManifest {
  const visualObjects: FuzzyCADGeneratedVisualObject[] = [];

  for (const annotation of annotations) {
    if (annotation.type === "size") {
      const uncertainAxes = (["x", "y", "z"] as const).filter(
        (axis) => annotation.confidence[axis] !== "high",
      );

      for (const axis of uncertainAxes) {
        visualObjects.push({
          id: `${annotation.id}:blur-shell:${axis}`,
          annotationId: annotation.id,
          kind: "blur-shell",
          targetPathKeys: annotation.target.pathKeys,
          axis,
        });

        visualObjects.push({
          id: `${annotation.id}:direction-arrow:${axis}`,
          annotationId: annotation.id,
          kind: "direction-arrow",
          targetPathKeys: annotation.target.pathKeys,
          axis,
        });
      }
    } else if (annotation.type === "angle") {
      // Angle annotation: represent as a rotated version of part2
      visualObjects.push({
        id: `${annotation.id}:angle-rotated-part`,
        annotationId: annotation.id,
        kind: "angle-rotated-part",
        targetPathKeys: [
          annotation.target.part1PathKey,
          annotation.target.part2PathKey,
        ],
        angleDeg: annotation.angleDeg,
      });
    } else if (annotation.type === "bend") {
      // Bend annotation: represent as a crease-deformed copy of the part
      visualObjects.push({
        id: `${annotation.id}:bent-part`,
        annotationId: annotation.id,
        kind: "bent-part",
        targetPathKeys: [annotation.target.pathKey],
        deltaDeg: annotation.deltaDeg,
      });
    }
  }

  return {
    visualObjects,
  };
}

export function buildFuzzyCADProjectState(input: {
  source: FuzzyCADUncertaintySource;
  annotations: FuzzyCADUncertaintyAnnotation[];
  objectSummaries: AxialStretchObjectSummary[];
  generatedGeometry?: FuzzyCADGeneratedGeometryState;
}): FuzzyCADProjectStateV1 {
  const source = normalizeSource(input.source);
  const now = new Date().toISOString();

  const previousGeneratedGeometry =
    input.generatedGeometry ?? createEmptyGeneratedGeometryState();

  const manifest = buildGeneratedGeometryManifest(input.annotations);

  return {
    schemaVersion: FUZZYCAD_PROJECT_STATE_SCHEMA_VERSION,

    project: {
      projectId: makeProjectId(source),
      name: "FuzzyCAD Project State",
      updatedAt: now,
    },

    source,

    objectMap: buildObjectMap(input.objectSummaries),

    annotations: input.annotations,

    generatedGeometry: {
      ...previousGeneratedGeometry,
      manifest,
      lastGeneratedAt:
        manifest.visualObjects.length > 0
          ? now
          : previousGeneratedGeometry.lastGeneratedAt ?? null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isFuzzyCADProjectState(
  value: unknown,
): value is FuzzyCADProjectStateV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === FUZZYCAD_PROJECT_STATE_SCHEMA_VERSION &&
    isRecord(value.project) &&
    isRecord(value.source) &&
    Array.isArray(value.annotations)
  );
}

export function isLegacyUncertaintyDocument(
  value: unknown,
): value is FuzzyCADUncertaintyDocument {
  return (
    isRecord(value) &&
    value.version === "0.1" &&
    isRecord(value.source) &&
    Array.isArray(value.annotations)
  );
}

export function projectStateToUncertaintyDocument(input: {
  state: FuzzyCADProjectStateV1;
  source: FuzzyCADUncertaintySource;
}): FuzzyCADUncertaintyDocument {
  return {
    version: "0.1",
    source: input.source,
    annotations: input.state.annotations,
  };
}

export function storedStateToProjectState(input: {
  storedState: unknown;
  source: FuzzyCADUncertaintySource;
  objectSummaries: AxialStretchObjectSummary[];
}): FuzzyCADProjectStateV1 | null {
  if (isFuzzyCADProjectState(input.storedState)) {
    return input.storedState;
  }

  if (isLegacyUncertaintyDocument(input.storedState)) {
    return buildFuzzyCADProjectState({
      source: input.source,
      annotations: input.storedState.annotations,
      objectSummaries: input.objectSummaries,
      generatedGeometry: createEmptyGeneratedGeometryState(),
    });
  }

  return null;
}