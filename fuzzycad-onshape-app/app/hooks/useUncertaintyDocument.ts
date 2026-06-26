import { useMemo, useState } from "react";
import {
  createEmptyUncertaintyDocument,
  removeSizeAnnotationsForPathKeys,
  removeUncertaintyAnnotationById,
  toFuzzyConfidenceAnnotations,
  updateUncertaintyAnnotationComment,
  upsertSizeAnnotation,
  type FuzzyCADUncertaintyDocument,
  type FuzzyCADUncertaintySource,
} from "../lib/uncertainty/document";
import type {
  AxisConfidenceMap,
  AxisDirectionMap,
} from "../lib/uncertainty/types";

export function useUncertaintyDocument(source: FuzzyCADUncertaintySource) {
  const [uncertaintyDocument, setUncertaintyDocument] =
    useState<FuzzyCADUncertaintyDocument>(() =>
      createEmptyUncertaintyDocument(source),
    );

  const uncertaintyDocumentWithCurrentSource = useMemo(
    () => ({
      ...uncertaintyDocument,
      source,
    }),
    [uncertaintyDocument, source],
  );

  const confidenceAnnotations = useMemo(
    () => toFuzzyConfidenceAnnotations(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  function resetUncertaintyDocument() {
    setUncertaintyDocument(createEmptyUncertaintyDocument(source));
  }

  function upsertSizeMark(input: {
    pathKeys: string[];
    confidence: AxisConfidenceMap;
    directions: AxisDirectionMap;
  }) {
    setUncertaintyDocument((previous) =>
      upsertSizeAnnotation(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function removeSizeMarks(pathKeys: string[]) {
    setUncertaintyDocument((previous) =>
      removeSizeAnnotationsForPathKeys(
        {
          ...previous,
          source,
        },
        pathKeys,
      ),
    );
  }

  function deleteAnnotation(annotationId: string) {
    setUncertaintyDocument((previous) =>
      removeUncertaintyAnnotationById(
        {
          ...previous,
          source,
        },
        annotationId,
      ),
    );
  }

  function updateAnnotationComment(annotationId: string, comment: string) {
    setUncertaintyDocument((previous) =>
      updateUncertaintyAnnotationComment(
        {
          ...previous,
          source,
        },
        annotationId,
        comment,
      ),
    );
  }

  return {
    uncertaintyDocument,
    uncertaintyDocumentWithCurrentSource,
    confidenceAnnotations,
    resetUncertaintyDocument,
    upsertSizeMark,
    removeSizeMarks,
    deleteAnnotation,
    updateAnnotationComment,
  };
}