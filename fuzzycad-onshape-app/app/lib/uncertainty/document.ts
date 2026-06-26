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

export type FuzzyCADUncertaintyAnnotation = SizeUncertaintyAnnotation;

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
    .map((annotation) => removePathKeysFromSizeAnnotation(annotation, pathKeySet))
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
      .map((annotation) =>
        removePathKeysFromSizeAnnotation(annotation, pathKeySet),
      )
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
    document.annotations.find((annotation) =>
      annotation.target.pathKeys.includes(pathKey),
    ) ?? null
  );
}

export function toFuzzyConfidenceAnnotations(
  document: FuzzyCADUncertaintyDocument,
): FuzzyConfidenceAnnotation[] {
  return document.annotations.flatMap((annotation) =>
    annotation.target.pathKeys.map((pathKey) => ({
      pathKey,
      confidence: annotation.confidence,
      directions: annotation.directions,
    })),
  );
}