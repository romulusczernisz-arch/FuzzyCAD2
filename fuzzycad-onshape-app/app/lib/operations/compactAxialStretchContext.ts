import type {
  AxialStretchObjectSummary,
  Vec3Tuple,
} from "./axialStretchTypes";

type CompactShapeKind = "elongated" | "compact" | "flat" | "unknown";

export type CompactAxialStretchObject = {
  id: string;
  name: string | null;
  selected: boolean;
  shape: CompactShapeKind;
  length: number;
  thickness: number;
  elongation: number;
  axis: Vec3Tuple;
  yRange: [number, number];
};

export type CompactAxialStretchGroup = {
  id: string;
  namePattern: string;
  count: number;
  selectedCount: number;
  shape: CompactShapeKind;
  avgLength: number;
  avgThickness: number;
  avgElongation: number;
  avgAxis: Vec3Tuple;
  yRange: [number, number];
  objectIds: string[];
};

export type CompactAxialStretchContext = {
  aiPayload: {
    operation: "height";
    instruction: string;
    heightDirection: Vec3Tuple;
    selectionSummary: {
      selectedObjectCount: number;
      candidateObjectCount: number;
      candidateGroupCount: number;
    };
    objects: CompactAxialStretchObject[];
    groups: CompactAxialStretchGroup[];
  };
  aliasMap: Record<string, string>;
};

function roundNumber(value: number, digits = 3) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function roundVec3(value: Vec3Tuple, digits = 3): Vec3Tuple {
  return [
    roundNumber(value[0], digits),
    roundNumber(value[1], digits),
    roundNumber(value[2], digits),
  ];
}

function getYRange(summary: AxialStretchObjectSummary): [number, number] {
  const y1 = summary.negativeEndWorld[1];
  const y2 = summary.positiveEndWorld[1];

  return [roundNumber(Math.min(y1, y2)), roundNumber(Math.max(y1, y2))];
}

function classifyShape(summary: AxialStretchObjectSummary): CompactShapeKind {
  if (summary.elongationRatio >= 4) {
    return "elongated";
  }

  const sortedAabb = [...summary.aabbSizeWorld].sort((a, b) => a - b);
  const smallest = Math.max(sortedAabb[0], 1e-6);
  const middle = Math.max(sortedAabb[1], 1e-6);
  const largest = Math.max(sortedAabb[2], 1e-6);

  if (largest / middle < 2.2 && middle / smallest > 3.5) {
    return "flat";
  }

  if (summary.elongationRatio < 2.2) {
    return "compact";
  }

  return "unknown";
}

function simplifyName(name: string | null) {
  if (!name) {
    return "Unnamed";
  }

  return name
    .replace(/_\d+$/g, "")
    .replace(/\s*<\d+>\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeCompactObject(
  summary: AxialStretchObjectSummary,
  id: string,
): CompactAxialStretchObject {
  return {
    id,
    name: summary.name,
    selected: summary.selectedByLasso,
    shape: classifyShape(summary),
    length: roundNumber(summary.axisLength),
    thickness: roundNumber(summary.crossSectionSize),
    elongation: roundNumber(summary.elongationRatio, 1),
    axis: roundVec3(summary.principalAxisWorld, 2),
    yRange: getYRange(summary),
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageAxis(objects: CompactAxialStretchObject[]): Vec3Tuple {
  if (objects.length === 0) {
    return [0, 1, 0];
  }

  const first = objects[0].axis;
  let x = 0;
  let y = 0;
  let z = 0;

  for (const object of objects) {
    const dot =
      first[0] * object.axis[0] +
      first[1] * object.axis[1] +
      first[2] * object.axis[2];

    const sign = dot < 0 ? -1 : 1;

    x += object.axis[0] * sign;
    y += object.axis[1] * sign;
    z += object.axis[2] * sign;
  }

  const length = Math.sqrt(x * x + y * y + z * z) || 1;

  return roundVec3([x / length, y / length, z / length], 2);
}

function buildGroups(objects: CompactAxialStretchObject[]) {
  const groups = new Map<string, CompactAxialStretchObject[]>();

  for (const object of objects) {
    const key = `${simplifyName(object.name)}:${object.shape}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)?.push(object);
  }

  return Array.from(groups.entries())
    .map(([key, groupObjects], index): CompactAxialStretchGroup => {
      const namePattern = key.split(":")[0] || "Unnamed";
      const yMin = Math.min(...groupObjects.map((item) => item.yRange[0]));
      const yMax = Math.max(...groupObjects.map((item) => item.yRange[1]));

      return {
        id: `g${index + 1}`,
        namePattern,
        count: groupObjects.length,
        selectedCount: groupObjects.filter((item) => item.selected).length,
        shape: groupObjects[0]?.shape ?? "unknown",
        avgLength: roundNumber(average(groupObjects.map((item) => item.length))),
        avgThickness: roundNumber(
          average(groupObjects.map((item) => item.thickness)),
        ),
        avgElongation: roundNumber(
          average(groupObjects.map((item) => item.elongation)),
          1,
        ),
        avgAxis: averageAxis(groupObjects),
        yRange: [roundNumber(yMin), roundNumber(yMax)],
        objectIds: groupObjects.map((item) => item.id),
      };
    })
    .sort((a, b) => {
      if (b.selectedCount !== a.selectedCount) {
        return b.selectedCount - a.selectedCount;
      }

      return b.avgElongation - a.avgElongation;
    });
}

export function buildCompactAxialStretchContext(
  summaries: AxialStretchObjectSummary[],
  selectedPathKeys: string[],
): CompactAxialStretchContext {
  const selectedSet = new Set(selectedPathKeys);

  const selectedSummaries = summaries.filter(
    (summary) => summary.selectedByLasso || selectedSet.has(summary.pathKey),
  );

  const similarPathKeys = new Set<string>();

  for (const summary of selectedSummaries) {
    for (const pathKey of summary.similarPathKeys) {
      similarPathKeys.add(pathKey);
    }
  }

  const candidates = summaries
    .filter(
      (summary) =>
        summary.selectedByLasso ||
        selectedSet.has(summary.pathKey) ||
        similarPathKeys.has(summary.pathKey),
    )
    .sort((a, b) => {
      if (Number(b.selectedByLasso) !== Number(a.selectedByLasso)) {
        return Number(b.selectedByLasso) - Number(a.selectedByLasso);
      }

      return b.elongationRatio - a.elongationRatio;
    })
    .slice(0, 80);

  const aliasMap: Record<string, string> = {};

  const compactObjects = candidates.map((summary, index) => {
    const id = `o${index + 1}`;
    aliasMap[id] = summary.pathKey;
    return makeCompactObject(summary, id);
  });

  const groups = buildGroups(compactObjects).slice(0, 30);

  return {
    aiPayload: {
      operation: "height",
      instruction:
        "Infer an axial stretch plan. The user wants to change overall height. Stretch elongated members along their own axes. Do not stretch compact connectors. Classify groups or objects as stretchTarget, moveWithEnd, fixedAnchor, or excluded.",
      heightDirection: [0, 1, 0],
      selectionSummary: {
        selectedObjectCount: selectedSummaries.length,
        candidateObjectCount: compactObjects.length,
        candidateGroupCount: groups.length,
      },
      objects: compactObjects,
      groups,
    },
    aliasMap,
  };
}