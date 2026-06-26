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

export function updateUncertaintyDocumentSource(
  document: FuzzyCADUncertaintyDocument,
  source: FuzzyCADUncertaintySource,
): FuzzyCADUncertaintyDocument {
  return {
    ...document,
    source,
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
    (annotation) => annotation.type === "size" && annotation.id === id,
  );

  const preservedAnnotations = document.annotations
    .map((annotation) => {
      if (annotation.type !== "size") {
        return annotation;
      }

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
      .map((annotation) => {
        if (annotation.type !== "size") {
          return annotation;
        }

        return removePathKeysFromSizeAnnotation(annotation, pathKeySet);
      })
      .filter(
        (
          annotation,
        ): annotation is FuzzyCADUncertaintyAnnotation => annotation !== null,
      ),
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
    if (annotation.type !== "size") {
      return [];
    }

    return annotation.target.pathKeys.map((pathKey) => ({
      pathKey,
      confidence: annotation.confidence,
      directions: annotation.directions,
    }));
  });
}