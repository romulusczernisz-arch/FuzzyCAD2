import * as THREE from "three";
import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  ConfidenceAxis,
  ConfidenceDirection,
  ConfidenceLevel,
  FuzzyConfidenceAnnotation,
} from "../../lib/uncertainty/types";

export type { FuzzyConfidenceAnnotation };

export type ConfidenceAxisFrame = Record<
  ConfidenceAxis,
  [number, number, number]
>;

const DEFAULT_AXIS_FRAME: ConfidenceAxisFrame = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

const DEFAULT_DIRECTIONS: AxisDirectionMap = {
  x: "both",
  y: "both",
  z: "both",
};

const FUZZY_VISUAL_CHILD = "__fuzzycad_uncertainty_visual_child__";

type UncertaintyVisualLevel = "medium" | "low";

type AxisExtent = {
  min: number;
  max: number;
};

type FrameMeasure = {
  centerWorld: THREE.Vector3;
  axes: Record<ConfidenceAxis, THREE.Vector3>;
  extents: Record<ConfidenceAxis, AxisExtent>;
  objectSize: number;
};

function stableRandom(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function signedRandom(seed: number) {
  return stableRandom(seed) * 2 - 1;
}

function normalizeAxisFrame(
  axisFrame: ConfidenceAxisFrame | undefined,
): Record<ConfidenceAxis, THREE.Vector3> {
  const frame = axisFrame ?? DEFAULT_AXIS_FRAME;

  const x = new THREE.Vector3(...frame.x).normalize();
  const y = new THREE.Vector3(...frame.y).normalize();
  const z = new THREE.Vector3(...frame.z).normalize();

  return { x, y, z };
}

function confidenceToVisualLevel(
  confidence: ConfidenceLevel,
): UncertaintyVisualLevel | null {
  if (confidence === "low") {
    return "low";
  }

  if (confidence === "medium") {
    return "medium";
  }

  return null;
}

function getDirectionSigns(direction: ConfidenceDirection) {
  if (direction === "positive") {
    return [1];
  }

  if (direction === "negative") {
    return [-1];
  }

  return [-1, 1];
}

function getOtherAxes(axis: ConfidenceAxis): [ConfidenceAxis, ConfidenceAxis] {
  if (axis === "x") {
    return ["y", "z"];
  }

  if (axis === "y") {
    return ["x", "z"];
  }

  return ["x", "y"];
}

function getRemainingAxis(
  axisA: ConfidenceAxis,
  axisB: ConfidenceAxis,
): ConfidenceAxis {
  const axes: ConfidenceAxis[] = ["x", "y", "z"];

  for (const axis of axes) {
    if (axis !== axisA && axis !== axisB) {
      return axis;
    }
  }

  return "z";
}

function getAxisSpan(extent: AxisExtent) {
  return extent.max - extent.min;
}

function getPrimaryAxis(measure: FrameMeasure): ConfidenceAxis {
  const xSpan = getAxisSpan(measure.extents.x);
  const ySpan = getAxisSpan(measure.extents.y);
  const zSpan = getAxisSpan(measure.extents.z);

  if (xSpan >= ySpan && xSpan >= zSpan) {
    return "x";
  }

  if (ySpan >= xSpan && ySpan >= zSpan) {
    return "y";
  }

  return "z";
}

function clearFuzzyVisualChildren(scene: THREE.Object3D) {
  const toRemove: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (!object.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    if (object.parent?.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    toRemove.push(object);
  });

  for (const child of toRemove) {
    if (!child.parent) {
      continue;
    }

    child.traverse((node) => {
      if (node instanceof THREE.LineSegments || node instanceof THREE.Line) {
        node.geometry.dispose();

        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];

        for (const material of materials) {
          material.dispose();
        }
      }
    });

    child.parent.remove(child);
  }
}

function hasSelectedAncestor(
  object: THREE.Object3D,
  selectedPathKeys: Set<string>,
) {
  let parent = object.parent;

  while (parent) {
    const parentPathKey = parent.userData?.fuzzyPathKey;

    if (
      typeof parentPathKey === "string" &&
      selectedPathKeys.has(parentPathKey)
    ) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
}

function findTopLevelObjectsByPathKeys(
  scene: THREE.Object3D,
  pathKeys: string[],
) {
  const selectedPathKeys = new Set(pathKeys);
  const objects: THREE.Object3D[] = [];

  scene.traverse((object) => {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") {
      return;
    }

    if (!selectedPathKeys.has(pathKey)) {
      return;
    }

    if (hasSelectedAncestor(object, selectedPathKeys)) {
      return;
    }

    if (object.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    objects.push(object);
  });

  return objects;
}

function measureObjectInFrame(
  object: THREE.Object3D,
  axisFrame: ConfidenceAxisFrame | undefined,
): FrameMeasure | null {
  const axes = normalizeAxisFrame(axisFrame);

  const box = new THREE.Box3().setFromObject(object);
  const centerWorld = new THREE.Vector3();

  box.getCenter(centerWorld);

  const extents: Record<ConfidenceAxis, AxisExtent> = {
    x: { min: Infinity, max: -Infinity },
    y: { min: Infinity, max: -Infinity },
    z: { min: Infinity, max: -Infinity },
  };

  let foundAnyVertex = false;

  const world = new THREE.Vector3();
  const relative = new THREE.Vector3();

  object.updateWorldMatrix(true, true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const geometry = child.geometry;

    if (!geometry) {
      return;
    }

    const position = geometry.getAttribute("position");

    if (!position) {
      return;
    }

    child.updateWorldMatrix(true, false);

    for (let index = 0; index < position.count; index += 1) {
      world.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
      relative.copy(world).sub(centerWorld);

      const x = relative.dot(axes.x);
      const y = relative.dot(axes.y);
      const z = relative.dot(axes.z);

      if (x < extents.x.min) extents.x.min = x;
      if (x > extents.x.max) extents.x.max = x;

      if (y < extents.y.min) extents.y.min = y;
      if (y > extents.y.max) extents.y.max = y;

      if (z < extents.z.min) extents.z.min = z;
      if (z > extents.z.max) extents.z.max = z;

      foundAnyVertex = true;
    }
  });

  if (!foundAnyVertex) {
    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];

    for (const corner of corners) {
      relative.copy(corner).sub(centerWorld);

      const x = relative.dot(axes.x);
      const y = relative.dot(axes.y);
      const z = relative.dot(axes.z);

      if (x < extents.x.min) extents.x.min = x;
      if (x > extents.x.max) extents.x.max = x;

      if (y < extents.y.min) extents.y.min = y;
      if (y > extents.y.max) extents.y.max = y;

      if (z < extents.z.min) extents.z.min = z;
      if (z > extents.z.max) extents.z.max = z;
    }

    foundAnyVertex = true;
  }

  if (!foundAnyVertex) {
    return null;
  }

  const xSpan = getAxisSpan(extents.x);
  const ySpan = getAxisSpan(extents.y);
  const zSpan = getAxisSpan(extents.z);

  return {
    centerWorld,
    axes,
    extents,
    objectSize: Math.max(xSpan, ySpan, zSpan, 0.001),
  };
}

function makePointFromCoords(
  measure: FrameMeasure,
  coords: Record<ConfidenceAxis, number>,
) {
  return measure.centerWorld
    .clone()
    .add(measure.axes.x.clone().multiplyScalar(coords.x))
    .add(measure.axes.y.clone().multiplyScalar(coords.y))
    .add(measure.axes.z.clone().multiplyScalar(coords.z));
}

function addSketchSegment({
  positions,
  object,
  startWorld,
  endWorld,
  jitterAmount,
  seed,
  steps = 6,
}: {
  positions: number[];
  object: THREE.Object3D;
  startWorld: THREE.Vector3;
  endWorld: THREE.Vector3;
  jitterAmount: number;
  seed: number;
  steps?: number;
}) {
  const direction = endWorld.clone().sub(startWorld);
  const length = direction.length();

  if (length < 1e-8) {
    return;
  }

  direction.normalize();

  const reference =
    Math.abs(direction.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);

  const normal1 = new THREE.Vector3().crossVectors(direction, reference);

  if (normal1.lengthSq() < 1e-8) {
    normal1.set(0, 0, 1).cross(direction).normalize();
  } else {
    normal1.normalize();
  }

  const normal2 = new THREE.Vector3().crossVectors(direction, normal1).normalize();

  let previousLocal = object.worldToLocal(startWorld.clone());

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const point = new THREE.Vector3().lerpVectors(startWorld, endWorld, t);

    if (step < steps) {
      const offset1 = signedRandom(seed + step * 17) * jitterAmount;
      const offset2 = signedRandom(seed + step * 31) * jitterAmount;

      point
        .add(normal1.clone().multiplyScalar(offset1))
        .add(normal2.clone().multiplyScalar(offset2));
    }

    const currentLocal = object.worldToLocal(point.clone());

    positions.push(
      previousLocal.x,
      previousLocal.y,
      previousLocal.z,
      currentLocal.x,
      currentLocal.y,
      currentLocal.z,
    );

    previousLocal = currentLocal;
  }
}

function addLoopOutline({
  positions,
  object,
  pointsWorld,
  jitterAmount,
  seed,
}: {
  positions: number[];
  object: THREE.Object3D;
  pointsWorld: THREE.Vector3[];
  jitterAmount: number;
  seed: number;
}) {
  for (let index = 0; index < pointsWorld.length; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: pointsWorld[index],
      endWorld: pointsWorld[(index + 1) % pointsWorld.length],
      jitterAmount,
      seed: seed + index * 19,
    });
  }
}

function buildCapCorners({
  measure,
  dimensionAxis,
  dimensionValue,
  uAxis,
  uMin,
  uMax,
  vAxis,
  vMin,
  vMax,
}: {
  measure: FrameMeasure;
  dimensionAxis: ConfidenceAxis;
  dimensionValue: number;
  uAxis: ConfidenceAxis;
  uMin: number;
  uMax: number;
  vAxis: ConfidenceAxis;
  vMin: number;
  vMax: number;
}) {
  const p0 = {
    x: 0,
    y: 0,
    z: 0,
  } as Record<ConfidenceAxis, number>;

  const p1 = {
    x: 0,
    y: 0,
    z: 0,
  } as Record<ConfidenceAxis, number>;

  const p2 = {
    x: 0,
    y: 0,
    z: 0,
  } as Record<ConfidenceAxis, number>;

  const p3 = {
    x: 0,
    y: 0,
    z: 0,
  } as Record<ConfidenceAxis, number>;

  p0[dimensionAxis] = dimensionValue;
  p1[dimensionAxis] = dimensionValue;
  p2[dimensionAxis] = dimensionValue;
  p3[dimensionAxis] = dimensionValue;

  p0[uAxis] = uMin;
  p1[uAxis] = uMax;
  p2[uAxis] = uMax;
  p3[uAxis] = uMin;

  p0[vAxis] = vMin;
  p1[vAxis] = vMin;
  p2[vAxis] = vMax;
  p3[vAxis] = vMax;

  return [
    makePointFromCoords(measure, p0),
    makePointFromCoords(measure, p1),
    makePointFromCoords(measure, p2),
    makePointFromCoords(measure, p3),
  ];
}

function addCrossHatchSlices({
  positions,
  object,
  measure,
  dimensionAxis,
  fromDimension,
  toDimension,
  uAxis,
  uMin,
  uMax,
  vAxis,
  vMin,
  vMax,
  level,
  jitterAmount,
  seed,
}: {
  positions: number[];
  object: THREE.Object3D;
  measure: FrameMeasure;
  dimensionAxis: ConfidenceAxis;
  fromDimension: number;
  toDimension: number;
  uAxis: ConfidenceAxis;
  uMin: number;
  uMax: number;
  vAxis: ConfidenceAxis;
  vMin: number;
  vMax: number;
  level: UncertaintyVisualLevel;
  jitterAmount: number;
  seed: number;
}) {
  const dimensionLength = Math.abs(toDimension - fromDimension);
  const uSpan = Math.abs(uMax - uMin);
  const vSpan = Math.abs(vMax - vMin);
  const crossSize = Math.max(Math.min(uSpan, vSpan), 0.001);

  const spacing = crossSize * (level === "low" ? 0.42 : 0.72);
  const count = Math.max(3, Math.ceil(dimensionLength / Math.max(spacing, 0.001)));

  for (let index = 0; index <= count; index += 1) {
    const t = count === 0 ? 0 : index / count;
    const dimension = THREE.MathUtils.lerp(fromDimension, toDimension, t);

    const marginU = uSpan * 0.12;
    const marginV = vSpan * 0.12;

    const orientation = index % 2;
    const jitterU = signedRandom(seed + index * 23) * uSpan * 0.06;
    const jitterV = signedRandom(seed + index * 29) * vSpan * 0.06;

    const startCoords = {
      x: 0,
      y: 0,
      z: 0,
    } as Record<ConfidenceAxis, number>;

    const endCoords = {
      x: 0,
      y: 0,
      z: 0,
    } as Record<ConfidenceAxis, number>;

    startCoords[dimensionAxis] = dimension;
    endCoords[dimensionAxis] = dimension;

    if (orientation === 0) {
      startCoords[uAxis] = uMin + marginU + jitterU;
      startCoords[vAxis] = vMin + marginV * 0.5;

      endCoords[uAxis] = uMax - marginU * 0.5;
      endCoords[vAxis] = vMax - marginV + jitterV;
    } else {
      startCoords[uAxis] = uMin + marginU;
      startCoords[vAxis] = vMax - marginV + jitterV;

      endCoords[uAxis] = uMax - marginU + jitterU;
      endCoords[vAxis] = vMin + marginV * 0.5;
    }

    const startWorld = makePointFromCoords(measure, startCoords);
    const endWorld = makePointFromCoords(measure, endCoords);

    addSketchSegment({
      positions,
      object,
      startWorld,
      endWorld,
      jitterAmount: jitterAmount * (level === "low" ? 0.75 : 0.45),
      seed: seed + index * 41,
      steps: 5,
    });
  }
}

function addFaceHatchBands({
  positions,
  object,
  measure,
  fixedAxis,
  fixedValue,
  axisA,
  aMin,
  aMax,
  axisB,
  bMin,
  bMax,
  level,
  jitterAmount,
  seed,
}: {
  positions: number[];
  object: THREE.Object3D;
  measure: FrameMeasure;
  fixedAxis: ConfidenceAxis;
  fixedValue: number;
  axisA: ConfidenceAxis;
  aMin: number;
  aMax: number;
  axisB: ConfidenceAxis;
  bMin: number;
  bMax: number;
  level: UncertaintyVisualLevel;
  jitterAmount: number;
  seed: number;
}) {
  const aSpan = Math.abs(aMax - aMin);
  const bSpan = Math.abs(bMax - bMin);

  const bandLength = Math.max(bSpan * (level === "low" ? 1.05 : 0.82), aSpan * 0.12);
  const spacing = Math.max(bSpan * (level === "low" ? 0.65 : 0.95), aSpan * 0.05);
  const count = Math.max(4, Math.ceil(aSpan / Math.max(spacing, 0.001)));

  for (let index = 0; index < count; index += 1) {
    const startA =
      aMin +
      index * spacing +
      stableRandom(seed + index * 13) * spacing * 0.35;
    const endA = Math.min(aMax, startA + bandLength);

    const orientation = index % 2;
    const marginB = bSpan * 0.16;
    const jitterB = signedRandom(seed + index * 37) * bSpan * 0.08;

    const startCoords = {
      x: 0,
      y: 0,
      z: 0,
    } as Record<ConfidenceAxis, number>;

    const endCoords = {
      x: 0,
      y: 0,
      z: 0,
    } as Record<ConfidenceAxis, number>;

    startCoords[fixedAxis] = fixedValue;
    endCoords[fixedAxis] = fixedValue;

    if (orientation === 0) {
      startCoords[axisA] = startA;
      endCoords[axisA] = endA;

      startCoords[axisB] = bMin + marginB;
      endCoords[axisB] = bMax - marginB + jitterB;
    } else {
      startCoords[axisA] = startA;
      endCoords[axisA] = endA;

      startCoords[axisB] = bMax - marginB + jitterB;
      endCoords[axisB] = bMin + marginB;
    }

    const startWorld = makePointFromCoords(measure, startCoords);
    const endWorld = makePointFromCoords(measure, endCoords);

    addSketchSegment({
      positions,
      object,
      startWorld,
      endWorld,
      jitterAmount: jitterAmount * (level === "low" ? 0.75 : 0.48),
      seed: seed + index * 47,
      steps: 5,
    });
  }
}

function createLongitudinalLayer({
  object,
  measure,
  uncertaintyAxis,
  sign,
  level,
  layerIndex,
  layerCount,
}: {
  object: THREE.Object3D;
  measure: FrameMeasure;
  uncertaintyAxis: ConfidenceAxis;
  sign: number;
  level: UncertaintyVisualLevel;
  layerIndex: number;
  layerCount: number;
}) {
  const [uAxis, vAxis] = getOtherAxes(uncertaintyAxis);

  const originalMin = measure.extents[uncertaintyAxis].min;
  const originalMax = measure.extents[uncertaintyAxis].max;
  const originalBoundary = sign > 0 ? originalMax : originalMin;

  const uMin = measure.extents[uAxis].min;
  const uMax = measure.extents[uAxis].max;
  const vMin = measure.extents[vAxis].min;
  const vMax = measure.extents[vAxis].max;

  const layerScale = (layerIndex + 1) / layerCount;
  const axisLength = getAxisSpan(measure.extents[uncertaintyAxis]);

  const extensionAmount =
    Math.max(axisLength, measure.objectSize * 0.18) *
    (level === "low" ? 0.16 : 0.08) *
    layerScale;

  const uncertainBoundary = originalBoundary + sign * extensionAmount;

  const jitterAmount =
    measure.objectSize *
    (level === "low" ? 0.004 : 0.0022) *
    (1 + layerScale * 0.35);

  const positions: number[] = [];

  const startCap = buildCapCorners({
    measure,
    dimensionAxis: uncertaintyAxis,
    dimensionValue: originalMin,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  const endCap = buildCapCorners({
    measure,
    dimensionAxis: uncertaintyAxis,
    dimensionValue: originalMax,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  const originalBoundaryCap = buildCapCorners({
    measure,
    dimensionAxis: uncertaintyAxis,
    dimensionValue: originalBoundary,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  const uncertainCap = buildCapCorners({
    measure,
    dimensionAxis: uncertaintyAxis,
    dimensionValue: uncertainBoundary,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  // Body rails
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: startCap[index],
      endWorld: endCap[index],
      jitterAmount: jitterAmount * 0.45,
      seed: layerIndex * 1000 + 10 + index * 17,
      steps: 5,
    });
  }

  // Body hatch
  addCrossHatchSlices({
    positions,
    object,
    measure,
    dimensionAxis: uncertaintyAxis,
    fromDimension: originalMin,
    toDimension: originalMax,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
    level,
    jitterAmount,
    seed: layerIndex * 1000 + 200,
  });

  // Connector rails
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: originalBoundaryCap[index],
      endWorld: uncertainCap[index],
      jitterAmount: jitterAmount * 0.55,
      seed: layerIndex * 1000 + 500 + index * 19,
      steps: 5,
    });
  }

  // Uncertain cap outline
  addLoopOutline({
    positions,
    object,
    pointsWorld: uncertainCap,
    jitterAmount,
    seed: layerIndex * 1000 + 800,
  });

  // Extension hatch
  addCrossHatchSlices({
    positions,
    object,
    measure,
    dimensionAxis: uncertaintyAxis,
    fromDimension: originalBoundary,
    toDimension: uncertainBoundary,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
    level,
    jitterAmount,
    seed: layerIndex * 1000 + 950,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.LineBasicMaterial({
    color: level === "low" ? 0x0f172a : 0x475569,
    transparent: true,
    opacity: level === "low" ? 0.72 : 0.48,
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(geometry, material);
  line.renderOrder = level === "low" ? 1250 + layerIndex : 1150 + layerIndex;
  line.frustumCulled = false;
  line.userData[FUZZY_VISUAL_CHILD] = true;

  return line;
}

function createTransverseLayer({
  object,
  measure,
  primaryAxis,
  uncertaintyAxis,
  sign,
  level,
  layerIndex,
  layerCount,
}: {
  object: THREE.Object3D;
  measure: FrameMeasure;
  primaryAxis: ConfidenceAxis;
  uncertaintyAxis: ConfidenceAxis;
  sign: number;
  level: UncertaintyVisualLevel;
  layerIndex: number;
  layerCount: number;
}) {
  const otherAxis = getRemainingAxis(primaryAxis, uncertaintyAxis);

  const primaryMin = measure.extents[primaryAxis].min;
  const primaryMax = measure.extents[primaryAxis].max;
  const otherMin = measure.extents[otherAxis].min;
  const otherMax = measure.extents[otherAxis].max;

  const originalBoundary =
    sign > 0
      ? measure.extents[uncertaintyAxis].max
      : measure.extents[uncertaintyAxis].min;

  const uncertaintySpan = getAxisSpan(measure.extents[uncertaintyAxis]);
  const layerScale = (layerIndex + 1) / layerCount;

  const offsetAmount =
    Math.max(uncertaintySpan, measure.objectSize * 0.045) *
    (level === "low" ? 0.7 : 0.35) *
    layerScale;

  const offsetBoundary = originalBoundary + sign * offsetAmount;

  const jitterAmount =
    measure.objectSize *
    (level === "low" ? 0.0036 : 0.0019) *
    (1 + layerScale * 0.35);

  const originalFace = buildCapCorners({
    measure,
    dimensionAxis: uncertaintyAxis,
    dimensionValue: originalBoundary,
    uAxis: primaryAxis,
    uMin: primaryMin,
    uMax: primaryMax,
    vAxis: otherAxis,
    vMin: otherMin,
    vMax: otherMax,
  });

  const offsetFace = buildCapCorners({
    measure,
    dimensionAxis: uncertaintyAxis,
    dimensionValue: offsetBoundary,
    uAxis: primaryAxis,
    uMin: primaryMin,
    uMax: primaryMax,
    vAxis: otherAxis,
    vMin: otherMin,
    vMax: otherMax,
  });

  const positions: number[] = [];

  // Offset face outline
  addLoopOutline({
    positions,
    object,
    pointsWorld: offsetFace,
    jitterAmount,
    seed: layerIndex * 1200 + 40,
  });

  // Connectors to original face
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: originalFace[index],
      endWorld: offsetFace[index],
      jitterAmount: jitterAmount * 0.55,
      seed: layerIndex * 1200 + 150 + index * 23,
      steps: 5,
    });
  }

  // Local hatch on the offset face
  addFaceHatchBands({
    positions,
    object,
    measure,
    fixedAxis: uncertaintyAxis,
    fixedValue: offsetBoundary,
    axisA: primaryAxis,
    aMin: primaryMin,
    aMax: primaryMax,
    axisB: otherAxis,
    bMin: otherMin,
    bMax: otherMax,
    level,
    jitterAmount,
    seed: layerIndex * 1200 + 320,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.LineBasicMaterial({
    color: level === "low" ? 0x0f172a : 0x475569,
    transparent: true,
    opacity: level === "low" ? 0.72 : 0.5,
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(geometry, material);
  line.renderOrder = level === "low" ? 1250 + layerIndex : 1150 + layerIndex;
  line.frustumCulled = false;
  line.userData[FUZZY_VISUAL_CHILD] = true;

  return line;
}

function createObjectLineArtRepresentation({
  object,
  confidence,
  directions,
  axisFrame,
}: {
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  axisFrame: ConfidenceAxisFrame;
}) {
  const measure = measureObjectInFrame(object, axisFrame);

  if (!measure) {
    return null;
  }

  const primaryAxis = getPrimaryAxis(measure);
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  const activeAxes = (["x", "y", "z"] as ConfidenceAxis[]).filter(
    (axis) => confidence[axis] !== "high",
  );

  for (const axis of activeAxes) {
    const visualLevel = confidenceToVisualLevel(confidence[axis]);

    if (!visualLevel) {
      continue;
    }

    const direction = directions[axis] ?? "both";
    const signs = getDirectionSigns(direction);
    const layerCount = confidence[axis] === "low" ? 3 : 1;

    for (const sign of signs) {
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
        const layer =
          axis === primaryAxis
            ? createLongitudinalLayer({
                object,
                measure,
                uncertaintyAxis: axis,
                sign,
                level: visualLevel,
                layerIndex,
                layerCount,
              })
            : createTransverseLayer({
                object,
                measure,
                primaryAxis,
                uncertaintyAxis: axis,
                sign,
                level: visualLevel,
                layerIndex,
                layerCount,
              });

        group.add(layer);
      }
    }
  }

  if (group.children.length === 0) {
    return null;
  }

  return group;
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
  axisFramesByPathKey?: Map<string, ConfidenceAxisFrame>,
) {
  scene.updateMatrixWorld(true);

  clearFuzzyVisualChildren(scene);

  if (annotations.length === 0) {
    return;
  }

  const annotationsByPathKey = new Map(
    annotations.map((annotation) => [annotation.pathKey, annotation]),
  );

  const targetObjects = findTopLevelObjectsByPathKeys(
    scene,
    annotations.map((annotation) => annotation.pathKey),
  );

  for (const object of targetObjects) {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") {
      continue;
    }

    const annotation = annotationsByPathKey.get(pathKey);

    if (!annotation) {
      continue;
    }

    const lineArt = createObjectLineArtRepresentation({
      object,
      confidence: annotation.confidence,
      directions: annotation.directions ?? DEFAULT_DIRECTIONS,
      axisFrame: axisFramesByPathKey?.get(pathKey) ?? DEFAULT_AXIS_FRAME,
    });

    if (!lineArt) {
      continue;
    }

    object.add(lineArt);
  }
}