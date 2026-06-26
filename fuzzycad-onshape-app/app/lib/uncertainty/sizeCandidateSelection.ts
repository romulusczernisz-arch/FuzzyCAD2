import type { AxialStretchObjectSummary } from "../../components/FuzzyCADGeometryViewer";

function normalizeSemanticObjectName(name: string | null) {
  if (!name) {
    return "";
  }

  return name
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/g, "")
    .replace(/[_\-\s]*\d+\s*$/g, "")
    .replace(/[_\-\s]+/g, "")
    .trim();
}

function getSizeSimilarity(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  const sourceSize = source.aabbSizeWorld;
  const targetSize = target.aabbSizeWorld;

  const ratios = sourceSize.map((sourceValue, index) => {
    const targetValue = targetSize[index];

    const minValue = Math.min(sourceValue, targetValue);
    const maxValue = Math.max(sourceValue, targetValue);

    if (maxValue < 1e-6) {
      return 1;
    }

    return minValue / maxValue;
  });

  return Math.min(...ratios);
}

function getAxisSimilarity(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  const sourceAxis = source.principalAxisWorld;
  const targetAxis = target.principalAxisWorld;

  return Math.abs(
    sourceAxis[0] * targetAxis[0] +
      sourceAxis[1] * targetAxis[1] +
      sourceAxis[2] * targetAxis[2],
  );
}

function isStrictGeometryMatch(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  if (source.pathKey === target.pathKey) {
    return false;
  }

  const sizeSimilarity = getSizeSimilarity(source, target);
  const axisSimilarity = getAxisSimilarity(source, target);

  const lengthRatio =
    Math.min(source.axisLength, target.axisLength) /
    Math.max(source.axisLength, target.axisLength);

  const thicknessRatio =
    Math.min(source.crossSectionSize, target.crossSectionSize) /
    Math.max(source.crossSectionSize, target.crossSectionSize);

  return (
    source.elongationRatio > 2.3 &&
    target.elongationRatio > 2.3 &&
    sizeSimilarity > 0.78 &&
    axisSimilarity > 0.86 &&
    lengthRatio > 0.78 &&
    thicknessRatio > 0.7
  );
}

export function buildSizeCandidatePathKeys(
  selectedSummary: AxialStretchObjectSummary,
  objectSummaries: AxialStretchObjectSummary[],
) {
  const selectedSemanticName = normalizeSemanticObjectName(
    selectedSummary.name,
  );

  const semanticMatches = objectSummaries.filter((summary) => {
    if (summary.pathKey === selectedSummary.pathKey) {
      return false;
    }

    if (!selectedSemanticName) {
      return false;
    }

    return normalizeSemanticObjectName(summary.name) === selectedSemanticName;
  });

  if (semanticMatches.length > 0) {
    return [
      selectedSummary.pathKey,
      ...semanticMatches.map((summary) => summary.pathKey),
    ];
  }

  const geometryMatches = objectSummaries.filter((summary) =>
    isStrictGeometryMatch(selectedSummary, summary),
  );

  return [
    selectedSummary.pathKey,
    ...geometryMatches.map((summary) => summary.pathKey),
  ];
}

export function getObjectDisplayName(summary: AxialStretchObjectSummary) {
  return summary.name || summary.pathKey;
}