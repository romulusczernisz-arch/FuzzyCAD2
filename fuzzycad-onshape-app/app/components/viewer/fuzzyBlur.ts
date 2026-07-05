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

const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";
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

function hasUncertainty(confidence: AxisConfidenceMap) {
  return (
    confidence.x !== "high" ||
    confidence.y !== "high" ||
    confidence.z !== "high"
  );
}

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

  return {
    x: new THREE.Vector3(...frame.x).normalize(),
    y: new THREE.Vector3(...frame.y).normalize(),
    z: new THREE.Vector3(...frame.z).normalize(),
  };
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

function getAxisSpan(extent: AxisExtent) {
  return Math.max(extent.max - extent.min, 0);
}

function getMeshMaterials(mesh: THREE.Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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
      if (!(node instanceof THREE.LineSegments || node instanceof THREE.Line)) {
        return;
      }

      node.geometry.dispose();

      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];

      for (const material of materials) {
        material.dispose();
      }
    });

    child.parent.remove(child);
  }
}

function restoreOriginalMaterials(scene: THREE.Object3D) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const originalMaterials = object.userData[
      FUZZY_ORIGINAL_MATERIALS
    ] as THREE.Material[] | undefined;

    if (!originalMaterials) {
      return;
    }

    const currentMaterials = getMeshMaterials(object);

    for (const material of currentMaterials) {
      if (material.userData?.[FUZZY_ACTIVE_MATERIAL]) {
        material.dispose();
      }
    }

    object.material =
      originalMaterials.length === 1 ? originalMaterials[0] : originalMaterials;

    delete object.userData[FUZZY_ORIGINAL_MATERIALS];
  });
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
  const objectBox = new THREE.Box3().setFromObject(object);
  const centerWorld = new THREE.Vector3();

  objectBox.getCenter(centerWorld);

  const extents: Record<ConfidenceAxis, AxisExtent> = {
    x: { min: Infinity, max: -Infinity },
    y: { min: Infinity, max: -Infinity },
    z: { min: Infinity, max: -Infinity },
  };

  let foundPoint = false;
  const world = new THREE.Vector3();
  const relative = new THREE.Vector3();

  object.updateWorldMatrix(true, true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const position = child.geometry.getAttribute("position");

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

      extents.x.min = Math.min(extents.x.min, x);
      extents.x.max = Math.max(extents.x.max, x);

      extents.y.min = Math.min(extents.y.min, y);
      extents.y.max = Math.max(extents.y.max, y);

      extents.z.min = Math.min(extents.z.min, z);
      extents.z.max = Math.max(extents.z.max, z);

      foundPoint = true;
    }
  });

  if (!foundPoint) {
    const corners = [
      new THREE.Vector3(objectBox.min.x, objectBox.min.y, objectBox.min.z),
      new THREE.Vector3(objectBox.min.x, objectBox.min.y, objectBox.max.z),
      new THREE.Vector3(objectBox.min.x, objectBox.max.y, objectBox.min.z),
      new THREE.Vector3(objectBox.min.x, objectBox.max.y, objectBox.max.z),
      new THREE.Vector3(objectBox.max.x, objectBox.min.y, objectBox.min.z),
      new THREE.Vector3(objectBox.max.x, objectBox.min.y, objectBox.max.z),
      new THREE.Vector3(objectBox.max.x, objectBox.max.y, objectBox.min.z),
      new THREE.Vector3(objectBox.max.x, objectBox.max.y, objectBox.max.z),
    ];

    for (const corner of corners) {
      relative.copy(corner).sub(centerWorld);

      const x = relative.dot(axes.x);
      const y = relative.dot(axes.y);
      const z = relative.dot(axes.z);

      extents.x.min = Math.min(extents.x.min, x);
      extents.x.max = Math.max(extents.x.max, x);

      extents.y.min = Math.min(extents.y.min, y);
      extents.y.max = Math.max(extents.y.max, y);

      extents.z.min = Math.min(extents.z.min, z);
      extents.z.max = Math.max(extents.z.max, z);
    }

    foundPoint = true;
  }

  if (!foundPoint) {
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
  steps = 5,
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

  if (direction.lengthSq() < 1e-12) {
    return;
  }

  direction.normalize();

  const reference =
    Math.abs(direction.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);

  const normalA = new THREE.Vector3().crossVectors(direction, reference);

  if (normalA.lengthSq() < 1e-12) {
    normalA.set(0, 0, 1).cross(direction).normalize();
  } else {
    normalA.normalize();
  }

  const normalB = new THREE.Vector3().crossVectors(direction, normalA).normalize();

  let previousLocal = object.worldToLocal(startWorld.clone());

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const point = new THREE.Vector3().lerpVectors(startWorld, endWorld, t);

    if (step < steps) {
      point
        .add(
          normalA
            .clone()
            .multiplyScalar(signedRandom(seed + step * 17) * jitterAmount),
        )
        .add(
          normalB
            .clone()
            .multiplyScalar(signedRandom(seed + step * 29) * jitterAmount),
        );
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

function buildCapCorners({
  measure,
  axis,
  value,
  uAxis,
  uMin,
  uMax,
  vAxis,
  vMin,
  vMax,
}: {
  measure: FrameMeasure;
  axis: ConfidenceAxis;
  value: number;
  uAxis: ConfidenceAxis;
  uMin: number;
  uMax: number;
  vAxis: ConfidenceAxis;
  vMin: number;
  vMax: number;
}) {
  const p0 = { x: 0, y: 0, z: 0 } as Record<ConfidenceAxis, number>;
  const p1 = { x: 0, y: 0, z: 0 } as Record<ConfidenceAxis, number>;
  const p2 = { x: 0, y: 0, z: 0 } as Record<ConfidenceAxis, number>;
  const p3 = { x: 0, y: 0, z: 0 } as Record<ConfidenceAxis, number>;

  p0[axis] = value;
  p1[axis] = value;
  p2[axis] = value;
  p3[axis] = value;

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
      steps: 5,
    });
  }
}

function addCapHatch({
  positions,
  object,
  measure,
  axis,
  value,
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
  axis: ConfidenceAxis;
  value: number;
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
  const uSpan = Math.abs(uMax - uMin);
  const vSpan = Math.abs(vMax - vMin);

  const shortAxis = uSpan <= vSpan ? uAxis : vAxis;
  const longAxis = uSpan <= vSpan ? vAxis : uAxis;

  const shortMin = uSpan <= vSpan ? uMin : vMin;
  const shortMax = uSpan <= vSpan ? uMax : vMax;

  const longMin = uSpan <= vSpan ? vMin : uMin;
  const longMax = uSpan <= vSpan ? vMax : uMax;

  const shortSpan = Math.max(shortMax - shortMin, 0.001);
  const longSpan = Math.max(longMax - longMin, 0.001);

  const longMargin = longSpan * 0.07;
  const shortMargin = shortSpan * 0.12;

  const spacing = shortSpan * (level === "low" ? 0.28 : 0.42);
  const count = Math.max(4, Math.ceil(longSpan / Math.max(spacing, 0.001)));

  const hatchLength = shortSpan * (level === "low" ? 0.9 : 0.78);
  const shortCenter = (shortMin + shortMax) / 2;

  const slant = longSpan * 0.045;

  for (let index = 0; index <= count; index += 1) {
    const t = count === 0 ? 0 : index / count;

    const longCenter =
      THREE.MathUtils.lerp(longMin + longMargin, longMax - longMargin, t) +
      signedRandom(seed + index * 37) * spacing * 0.16;

    const shortJitter = signedRandom(seed + index * 17) * shortSpan * 0.04;

    const shortStart =
      shortCenter - hatchLength / 2 + shortMargin * 0.3 + shortJitter;
    const shortEnd =
      shortCenter + hatchLength / 2 - shortMargin * 0.3 + shortJitter * 0.4;

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

    startCoords[axis] = value;
    endCoords[axis] = value;

    startCoords[shortAxis] = shortStart;
    endCoords[shortAxis] = shortEnd;

    // 单方向、略微斜一点；不 alternating，所以不会变成 X。
    startCoords[longAxis] = longCenter - slant;
    endCoords[longAxis] = longCenter + slant;

    const startWorld = makePointFromCoords(measure, startCoords);
    const endWorld = makePointFromCoords(measure, endCoords);

    addSketchSegment({
      positions,
      object,
      startWorld,
      endWorld,
      jitterAmount: jitterAmount * (level === "low" ? 0.7 : 0.42),
      seed: seed + index * 53,
      steps: 5,
    });
  }
}

function addBodyHatch({
  positions,
  object,
  measure,
  axis,
  fromValue,
  toValue,
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
  axis: ConfidenceAxis;
  fromValue: number;
  toValue: number;
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
  const length = Math.abs(toValue - fromValue);
  const crossSpan = Math.max(
    Math.min(Math.abs(uMax - uMin), Math.abs(vMax - vMin)),
    0.001,
  );

  const spacing = crossSpan * (level === "low" ? 0.42 : 0.62);
  const sliceCount = Math.max(2, Math.ceil(length / Math.max(spacing, 0.001)));

  for (let index = 0; index <= sliceCount; index += 1) {
    const t = sliceCount === 0 ? 0 : index / sliceCount;
    const value = THREE.MathUtils.lerp(fromValue, toValue, t);

    addCapHatch({
      positions,
      object,
      measure,
      axis,
      value,
      uAxis,
      uMin,
      uMax,
      vAxis,
      vMin,
      vMax,
      level,
      jitterAmount,
      seed: seed + index * 101,
    });
  }
}

function createAxisExtensionLayer({
  object,
  measure,
  axis,
  sign,
  level,
  layerIndex,
  layerCount,
}: {
  object: THREE.Object3D;
  measure: FrameMeasure;
  axis: ConfidenceAxis;
  sign: number;
  level: UncertaintyVisualLevel;
  layerIndex: number;
  layerCount: number;
}) {
  const [uAxis, vAxis] = getOtherAxes(axis);

  const originalMin = measure.extents[axis].min;
  const originalMax = measure.extents[axis].max;

  const originalBoundary = sign > 0 ? originalMax : originalMin;

  const uMin = measure.extents[uAxis].min;
  const uMax = measure.extents[uAxis].max;
  const vMin = measure.extents[vAxis].min;
  const vMax = measure.extents[vAxis].max;

  const axisSpan = Math.max(getAxisSpan(measure.extents[axis]), 0.001);
  const layerRatio = (layerIndex + 1) / layerCount;

  const extensionAmount =
    Math.max(axisSpan, measure.objectSize * 0.18) *
    (level === "low" ? 0.18 : 0.085) *
    layerRatio;

  const uncertainBoundary = originalBoundary + sign * extensionAmount;

  const jitterAmount =
    measure.objectSize *
    (level === "low" ? 0.0048 : 0.0024) *
    (1 + layerRatio * 0.25);

  const positions: number[] = [];

  const originalStartCap = buildCapCorners({
    measure,
    axis,
    value: originalMin,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  const originalEndCap = buildCapCorners({
    measure,
    axis,
    value: originalMax,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  const originalBoundaryCap = buildCapCorners({
    measure,
    axis,
    value: originalBoundary,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  const uncertainCap = buildCapCorners({
    measure,
    axis,
    value: uncertainBoundary,
    uAxis,
    uMin,
    uMax,
    vAxis,
    vMin,
    vMax,
  });

  // Body rails: very light structural sketch, same cross-section as original geo.
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: originalStartCap[index],
      endWorld: originalEndCap[index],
      jitterAmount: jitterAmount * 0.28,
      seed: layerIndex * 1000 + 10 + index * 17,
      steps: 5,
    });
  }

  // Body hatch: dense, one-direction, short-side oriented.
  if (layerIndex === 0) {
    addBodyHatch({
      positions,
      object,
      measure,
      axis,
      fromValue: originalMin,
      toValue: originalMax,
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
  }

  // Extension rails: along selected axis only.
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: originalBoundaryCap[index],
      endWorld: uncertainCap[index],
      jitterAmount: jitterAmount * 0.45,
      seed: layerIndex * 1000 + 500 + index * 19,
      steps: 5,
    });
  }

  // Extension cap outline.
  addLoopOutline({
    positions,
    object,
    pointsWorld: uncertainCap,
    jitterAmount,
    seed: layerIndex * 1000 + 800,
  });

  // Extension hatch: same hatch rule as body; no X, no long-edge parallel.
  addBodyHatch({
    positions,
    object,
    measure,
    axis,
    fromValue: originalBoundary,
    toValue: uncertainBoundary,
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
    opacity: level === "low" ? 0.7 : 0.46,
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(geometry, material);

  line.renderOrder = level === "low" ? 1300 + layerIndex : 1200 + layerIndex;
  line.frustumCulled = false;
  line.userData[FUZZY_VISUAL_CHILD] = true;

  return line;
}

function createObjectUncertaintySketch({
  object,
  confidence,
  directions,
  axisFrame,
}: {
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  axisFrame: ConfidenceAxisFrame | undefined;
}) {
  const measure = measureObjectInFrame(object, axisFrame);

  if (!measure) {
    return null;
  }

  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
    const visualLevel = confidenceToVisualLevel(confidence[axis]);

    if (!visualLevel) {
      return;
    }

    const signs = getDirectionSigns(directions[axis] ?? "both");
    const layerCount = confidence[axis] === "low" ? 2 : 1;

    for (const sign of signs) {
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
        group.add(
          createAxisExtensionLayer({
            object,
            measure,
            axis,
            sign,
            level: visualLevel,
            layerIndex,
            layerCount,
          }),
        );
      }
    }
  });

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
  restoreOriginalMaterials(scene);

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

    if (!annotation || !hasUncertainty(annotation.confidence)) {
      continue;
    }

    const sketch = createObjectUncertaintySketch({
      object,
      confidence: annotation.confidence,
      directions: annotation.directions ?? DEFAULT_DIRECTIONS,
      axisFrame: axisFramesByPathKey?.get(pathKey),
    });

    if (!sketch) {
      continue;
    }

    object.add(sketch);
  }
}