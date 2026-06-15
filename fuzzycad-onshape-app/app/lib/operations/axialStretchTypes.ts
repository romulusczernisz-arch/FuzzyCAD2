export type Vec3Tuple = [number, number, number];

export type MateConnectionSummary = {
  connectedPathKey: string;
  mateType: string | null;
  featureId: string | null;
  connectorOnThisWorld: Vec3Tuple | null;
  connectorOnOtherWorld: Vec3Tuple | null;
};

export type AxialStretchObjectSummary = {
  pathKey: string;
  name: string | null;
  selectedByLasso: boolean;

  // World-axis aligned bounding box. This is only a rough spatial envelope.
  aabbSizeWorld: Vec3Tuple;
  aabbCenterWorld: Vec3Tuple;

  // Real object-axis information computed from mesh points.
  principalAxisWorld: Vec3Tuple;
  axisLength: number;
  crossSectionSize: number;
  elongationRatio: number;

  // Two ends along the principal axis.
  negativeEndWorld: Vec3Tuple;
  positiveEndWorld: Vec3Tuple;

  // Assembly / mate information. We leave this empty in Step 1,
  // then fill it from relationshipGraph.mateEdges in Step 2.
  mateConnections: MateConnectionSummary[];

  // Similar repeated objects, useful for grouped operations.
  similarPathKeys: string[];
};

export type AxialStretchRole =
  | "stretchTarget"
  | "moveWithEnd"
  | "fixedAnchor"
  | "excluded";

export type AxialStretchFixedAnchor = {
  kind: "mate" | "geometricEnd" | "aiInferred";
  pointWorld: Vec3Tuple;
  end: "negativeEnd" | "positiveEnd";
  connectedPathKey?: string;
  mateType?: string | null;
};

export type AxialStretchPlanObject = {
  pathKey: string;
  role: AxialStretchRole;
  axisWorld?: Vec3Tuple;
  fixedAnchor?: AxialStretchFixedAnchor;
  confidence?: number;
  reason: string;
};

export type AxialStretchPlan = {
  operationType: "axialStretch";
  sourceSelectionPathKeys: string[];
  heightDirectionWorld: Vec3Tuple;
  objects: AxialStretchPlanObject[];
  linkedGroups: {
    id: string;
    pathKeys: string[];
    constraint: "sameHeightDelta" | "sameAxialDelta";
    reason: string;
  }[];
};