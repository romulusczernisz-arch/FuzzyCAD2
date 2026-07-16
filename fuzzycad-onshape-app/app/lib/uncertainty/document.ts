import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  FuzzyConfidenceAnnotation,
} from "./types";

export type FuzzyCADUncertaintyDocument = {
  version: "0.1";
  source: FuzzyCADUncertaintySource;
  annotations: FuzzyCADUncertaintyAnnotation[];
};

export type FuzzyCADUncertaintySource = {
  documentId: string | null;
  workspaceId: string | null;
  elementId: string | null;
  assemblyElementId: string | null;
  server: string;
};

export type FuzzyCADUncertaintyAnnotation =
  | SizeUncertaintyAnnotation
  | AngleUncertaintyAnnotation
  | BendUncertaintyAnnotation;

/**
 * Discriminated pivot union so angle-like tools can share one schema:
 * - "vertex": rotation around a hinge axis through a snapped mesh vertex
 *   (two-part angle tool).
 * - "line": rotation of part of a mesh around an explicit crease line
 *   (single-part bend tool).
 * All coordinates are in Onshape assembly space.
 */
export type AnglePivot =
  | { kind: "vertex"; point: [number, number, number] }
  | {
      kind: "line";
      start: [number, number, number];
      end: [number, number, number];
    };

export type SizeUncertaintyAnnotation = {
  id: string;
  type: "size";
  target: {
    pathKeys: string[];
    referencePathKey: string;
    scope: "single" | "group";
  };
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

export type AngleUncertaintyAnnotation = {
  id: string;
  type: "angle";
  target: {
    part1PathKey: string;
    part2PathKey: string;
    /**
     * All occurrences that move rigidly with part2 (excluding part1).
     * Computed by BFS over mateEdges at annotation-save time.
     * Included in STL export rotation and hidden in Onshape alongside part2.
     */
    relatedPart2PathKeys?: string[];
  };
  /** Measured / target angle between the two selected face normals (degrees). */
  angleDeg: number;
  /**
   * Face normals and pivot stored in Onshape assembly coordinate space.
   * Captured from the Three.js raycaster with the viewer's -π/2 display
   * rotation removed: viewerSpace(x,y,z) → onshapeSpace(x,-z,y).
   *
   * These are used in the STL export to compute the rotation transform that
   * achieves targetAngleDeg between the two faces.
   */
  face1Normal?: [number, number, number];
  face2Normal?: [number, number, number];
  /**
   * Legacy pivot field (Onshape space). Kept for backwards compatibility
   * with previously saved documents; new saves also populate `pivot`.
   */
  pivotPoint?: [number, number, number];
  /** Structured pivot. Preferred over pivotPoint when present. */
  pivot?: AnglePivot;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Bend uncertainty: a single part gets a crease line drawn across it; the
 * mesh on one side of the crease plane rotates around the crease by
 * `deltaDeg`. Models parts with an internal angle and no selectable vertex
 * (e.g. a prosthetic running blade).
 *
 * All geometry is stored in Onshape assembly space.
 */
export type BendUncertaintyAnnotation = {
  id: string;
  type: "bend";
  target: {
    pathKey: string;
  };
  /** Bend adjustment relative to the part's current shape, in degrees. */
  deltaDeg: number;
  /** Crease line endpoints on the part surface. */
  creaseStart: [number, number, number];
  creaseEnd: [number, number, number];
  /**
   * Normal of the cutting plane through the crease line
   * (creaseDir × surfaceNormal). Vertices are split by this plane.
   */
  planeNormal: [number, number, number];
  /** +1 or -1: which side of the plane (along planeNormal) bends. */
  bendSideSign: 1 | -1;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

export function createEmptyUncertaintyDocument(
  source: FuzzyCADUncertaintySource,
): FuzzyCADUncertaintyDocument {
  return {
    version: "0.1",
    source,
    annotations: [],
  };
}

export function makeSizeAnnotationId(pathKeys: string[]) {
  return `size:${pathKeys.slice().sort().join("|")}`;
}

export function makeAngleAnnotationId(
  part1PathKey: string,
  part2PathKey: string,
) {
  return `angle:${[part1PathKey, part2PathKey].sort().join("|")}`;
}

/**
 * Bend id includes the crease location so a part can carry multiple bends
 * at different creases; editing the same crease updates in place.
 */
export function makeBendAnnotationId(
  pathKey: string,
  creaseStart: [number, number, number],
  creaseEnd: [number, number, number],
) {
  const key = [...creaseStart, ...creaseEnd]
    .map((value) => value.toFixed(4))
    .join(",");
  return `bend:${pathKey}:${key}`;
}

function normalizePathKeys(pathKeys: string[]) {
  return Array.from(new Set(pathKeys)).filter((pathKey) => pathKey.length > 0);
}

function createSizeAnnotation(input: {
  pathKeys: string[];
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  comment?: string;
  createdAt?: string;
  updatedAt?: string;
}): SizeUncertaintyAnnotation | null {
  const pathKeys = normalizePathKeys(input.pathKeys);
  const referencePathKey = pathKeys[0];

  if (!referencePathKey) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: makeSizeAnnotationId(pathKeys),
    type: "size",
    target: {
      pathKeys,
      referencePathKey,
      scope: pathKeys.length > 1 ? "group" : "single",
    },
    confidence: { ...input.confidence },
    directions: { ...input.directions },
    comment: input.comment,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function removePathKeysFromSizeAnnotation(
  annotation: SizeUncertaintyAnnotation,
  pathKeysToRemove: Set<string>,
): SizeUncertaintyAnnotation | null {
  const remainingPathKeys = annotation.target.pathKeys.filter(
    (pathKey) => !pathKeysToRemove.has(pathKey),
  );

  if (remainingPathKeys.length === 0) {
    return null;
  }

  return createSizeAnnotation({
    pathKeys: remainingPathKeys,
    confidence: annotation.confidence,
    directions: annotation.directions,
    comment: annotation.comment,
    createdAt: annotation.createdAt,
    updatedAt: new Date().toISOString(),
  });
}

export function upsertSizeAnnotation(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKeys: string[];
    confidence: AxisConfidenceMap;
    directions: AxisDirectionMap;
  },
): FuzzyCADUncertaintyDocument {
  const pathKeys = normalizePathKeys(input.pathKeys);

  if (pathKeys.length === 0) {
    return document;
  }

  const now = new Date().toISOString();
  const pathKeySet = new Set(pathKeys);
  const id = makeSizeAnnotationId(pathKeys);

  const existingExactAnnotation = document.annotations.find(
    (annotation) => annotation.id === id,
  );

  const preservedAnnotations = document.annotations
    .map((annotation) => {
      if (annotation.type !== "size") return annotation;
      return removePathKeysFromSizeAnnotation(annotation, pathKeySet);
    })
    .filter(
      (
        annotation,
      ): annotation is FuzzyCADUncertaintyAnnotation => annotation !== null,
    );

  const nextAnnotation = createSizeAnnotation({
    pathKeys,
    confidence: input.confidence,
    directions: input.directions,
    comment: existingExactAnnotation?.comment,
    createdAt: existingExactAnnotation?.createdAt ?? now,
    updatedAt: now,
  });

  if (!nextAnnotation) {
    return {
      ...document,
      annotations: preservedAnnotations,
    };
  }

  return {
    ...document,
    annotations: [...preservedAnnotations, nextAnnotation],
  };
}

export function addAngleAnnotation(
  document: FuzzyCADUncertaintyDocument,
  input: {
    part1PathKey: string;
    part2PathKey: string;
    relatedPart2PathKeys?: string[];
    angleDeg: number;
    face1Normal?: [number, number, number];
    face2Normal?: [number, number, number];
    pivotPoint?: [number, number, number];
    pivot?: AnglePivot;
    comment?: string;
  },
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();
  const id = makeAngleAnnotationId(input.part1PathKey, input.part2PathKey);

  const existing = document.annotations.find(
    (a): a is AngleUncertaintyAnnotation => a.id === id && a.type === "angle",
  );

  const annotation: AngleUncertaintyAnnotation = {
    id,
    type: "angle",
    target: {
      part1PathKey: input.part1PathKey,
      part2PathKey: input.part2PathKey,
      relatedPart2PathKeys: input.relatedPart2PathKeys ?? existing?.target.relatedPart2PathKeys,
    },
    angleDeg: input.angleDeg,
    face1Normal: input.face1Normal ?? existing?.face1Normal,
    face2Normal: input.face2Normal ?? existing?.face2Normal,
    pivotPoint: input.pivotPoint ?? existing?.pivotPoint,
    pivot: input.pivot ?? existing?.pivot,
    comment: input.comment ?? existing?.comment,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return {
    ...document,
    annotations: [...document.annotations.filter((a) => a.id !== id), annotation],
  };
}

export function addBendAnnotation(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKey: string;
    deltaDeg: number;
    creaseStart: [number, number, number];
    creaseEnd: [number, number, number];
    planeNormal: [number, number, number];
    bendSideSign: 1 | -1;
    comment?: string;
  },
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();
  const id = makeBendAnnotationId(
    input.pathKey,
    input.creaseStart,
    input.creaseEnd,
  );

  const existing = document.annotations.find(
    (a): a is BendUncertaintyAnnotation => a.id === id && a.type === "bend",
  );

  const annotation: BendUncertaintyAnnotation = {
    id,
    type: "bend",
    target: { pathKey: input.pathKey },
    deltaDeg: input.deltaDeg,
    creaseStart: input.creaseStart,
    creaseEnd: input.creaseEnd,
    planeNormal: input.planeNormal,
    bendSideSign: input.bendSideSign,
    comment: input.comment ?? existing?.comment,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((a) => a.id !== id),
      annotation,
    ],
  };
}

export function removeSizeAnnotationsForPathKeys(
  document: FuzzyCADUncertaintyDocument,
  pathKeys: string[],
): FuzzyCADUncertaintyDocument {
  const pathKeySet = new Set(normalizePathKeys(pathKeys));

  if (pathKeySet.size === 0) {
    return document;
  }

  return {
    ...document,
    annotations: document.annotations
      .map((annotation) => {
        if (annotation.type !== "size") return annotation;
        return removePathKeysFromSizeAnnotation(annotation, pathKeySet);
      })
      .filter(
        (
          annotation,
        ): annotation is FuzzyCADUncertaintyAnnotation => annotation !== null,
      ),
  };
}

export function removeUncertaintyAnnotationById(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
): FuzzyCADUncertaintyDocument {
  return {
    ...document,
    annotations: document.annotations.filter(
      (annotation) => annotation.id !== annotationId,
    ),
  };
}

export function updateUncertaintyAnnotationComment(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  comment: string,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId) {
        return annotation;
      }

      return {
        ...annotation,
        comment,
        updatedAt: now,
      };
    }),
  };
}

export function findSizeAnnotationForPathKey(
  document: FuzzyCADUncertaintyDocument,
  pathKey: string | null,
) {
  if (!pathKey) {
    return null;
  }

  return (
    document.annotations.find(
      (annotation): annotation is SizeUncertaintyAnnotation =>
        annotation.type === "size" &&
        annotation.target.pathKeys.includes(pathKey),
    ) ?? null
  );
}

export function toFuzzyConfidenceAnnotations(
  document: FuzzyCADUncertaintyDocument,
): FuzzyConfidenceAnnotation[] {
  return document.annotations.flatMap((annotation) => {
    if (annotation.type !== "size") return [];
    return annotation.target.pathKeys.map((pathKey) => ({
      pathKey,
      confidence: annotation.confidence,
      directions: annotation.directions,
    }));
  });
}
