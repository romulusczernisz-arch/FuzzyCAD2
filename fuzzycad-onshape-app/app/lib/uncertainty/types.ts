export type ConfidenceAxis = "x" | "y" | "z";

export type ConfidenceLevel = "high" | "medium" | "low";

export type AxisConfidenceMap = Record<ConfidenceAxis, ConfidenceLevel>;

export type FuzzyConfidenceAnnotation = {
  pathKey: string;
  confidence: AxisConfidenceMap;
};

export const DEFAULT_HEIGHT_CONFIDENCE: AxisConfidenceMap = {
  x: "high",
  y: "low",
  z: "medium",
};