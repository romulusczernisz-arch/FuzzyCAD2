export type ConfidenceAxis = "x" | "y" | "z";

export type ConfidenceLevel = "high" | "medium" | "low";

export type ConfidenceDirection = "positive" | "negative" | "both";

export type AxisConfidenceMap = Record<ConfidenceAxis, ConfidenceLevel>;

export type AxisDirectionMap = Record<ConfidenceAxis, ConfidenceDirection>;

export type FuzzyConfidenceAnnotation = {
  pathKey: string;
  confidence: AxisConfidenceMap;
  directions?: AxisDirectionMap;
};

export const DEFAULT_HEIGHT_CONFIDENCE: AxisConfidenceMap = {
  x: "high",
  y: "low",
  z: "medium",
};

export const DEFAULT_HEIGHT_DIRECTIONS: AxisDirectionMap = {
  x: "both",
  y: "both",
  z: "both",
};