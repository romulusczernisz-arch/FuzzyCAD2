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

function confidenceToStrength(level: ConfidenceLevel) {
  if (level === "low") {
    return 1.0;
  }

  if (level === "medium") {
    return 0.55;
  }

  return 0.0;
}

function getMaxUncertainty(confidence: AxisConfidenceMap) {
  return Math.max(
    confidenceToStrength(confidence.x),
    confidenceToStrength(confidence.y),
    confidenceToStrength(confidence.z),
  );
}

function hasUncertainty(confidence: AxisConfidenceMap) {
  return getMaxUncertainty(confidence) > 0;
}






function getMeshMaterials(mesh: THREE.Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}





function disposeObjectVisual(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.LineSegments || child instanceof THREE.Mesh)) {
      return;
    }

    child.geometry.dispose();

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      material.dispose();
    }
  });
}

function clearFuzzyVisualChildren(scene: THREE.Object3D) {
  const childrenToRemove: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (!object.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    if (object.parent?.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    childrenToRemove.push(object);
  });

  for (const child of childrenToRemove) {
    if (!child.parent) {
      continue;
    }

    disposeObjectVisual(child);
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





function getConfidenceLineCount(level: ConfidenceLevel) {
  if (level === "low") {
    return 3;
  }

  if (level === "medium") {
    return 1;
  }

  return 0;
}

function getConfidenceOffsetMultiplier(level: ConfidenceLevel) {
  if (level === "low") {
    return 0.085;
  }

  if (level === "medium") {
    return 0.035;
  }

  return 0;
}

function getConfidenceJitterMultiplier(level: ConfidenceLevel) {
  if (level === "low") {
    return 0.012;
  }

  if (level === "medium") {
    return 0.0045;
  }

  return 0;
}

function getConfidenceLineOpacity(level: ConfidenceLevel) {
  if (level === "low") {
    return 0.92;
  }

  if (level === "medium") {
    return 0.72;
  }

  return 0;
}

function getConfidenceLineColor(level: ConfidenceLevel) {
  if (level === "low") {
    return 0x111111;
  }

  return 0x334155;
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

function seededNoise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}



type FrameMeasure = {
  centerWorld: THREE.Vector3;
  axes: Record<ConfidenceAxis, THREE.Vector3>;
  extents: Record<ConfidenceAxis, { min: number; max: number }>;
};

function getFrameAxes(axisFrame: ConfidenceAxisFrame) {
  return {
    x: new THREE.Vector3(...axisFrame.x).normalize(),
    y: new THREE.Vector3(...axisFrame.y).normalize(),
    z: new THREE.Vector3(...axisFrame.z).normalize(),
  };
}

function getBoxCorners(box: THREE.Box3) {
  return [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
  ];
}

function collectObjectWorldPoints(object: THREE.Object3D) {
  const points: THREE.Vector3[] = [];

  object.updateWorldMatrix(true, true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    child.geometry.computeBoundingBox();

    const localBox = child.geometry.boundingBox;

    if (!localBox) {
      return;
    }

    for (const corner of getBoxCorners(localBox)) {
      points.push(child.localToWorld(corner.clone()));
    }
  });

  if (points.length > 0) {
    return points;
  }

  const fallbackBox = new THREE.Box3().setFromObject(object);

  if (fallbackBox.isEmpty()) {
    return [];
  }

  return getBoxCorners(fallbackBox);
}

function measureObjectInFrame(
  object: THREE.Object3D,
  axisFrame: ConfidenceAxisFrame,
): FrameMeasure | null {
  const points = collectObjectWorldPoints(object);

  if (points.length === 0) {
    return null;
  }

  const worldBox = new THREE.Box3().setFromPoints(points);
  const centerWorld = new THREE.Vector3();

  worldBox.getCenter(centerWorld);

  const axes = getFrameAxes(axisFrame);

  const extents: FrameMeasure["extents"] = {
    x: { min: Infinity, max: -Infinity },
    y: { min: Infinity, max: -Infinity },
    z: { min: Infinity, max: -Infinity },
  };

  for (const point of points) {
    const relative = point.clone().sub(centerWorld);

    (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
      const value = relative.dot(axes[axis]);

      extents[axis].min = Math.min(extents[axis].min, value);
      extents[axis].max = Math.max(extents[axis].max, value);
    });
  }

  return {
    centerWorld,
    axes,
    extents,
  };
}

function getOtherFrameAxes(axis: ConfidenceAxis): [ConfidenceAxis, ConfidenceAxis] {
  if (axis === "x") {
    return ["y", "z"];
  }

  if (axis === "y") {
    return ["x", "z"];
  }

  return ["x", "y"];
}

function makeSketchyWorldSegmentPoints({
  start,
  end,
  jitterAmount,
  seed,
  segments = 9,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  jitterAmount: number;
  seed: number;
  segments?: number;
}) {
  const points: THREE.Vector3[] = [];

  const tangent = end.clone().sub(start);

  if (tangent.lengthSq() < 1e-12) {
    return points;
  }

  tangent.normalize();

  const helper =
    Math.abs(tangent.y) < 0.85
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);

  const normalA = new THREE.Vector3().crossVectors(tangent, helper).normalize();
  const normalB = new THREE.Vector3().crossVectors(tangent, normalA).normalize();

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const base = start.clone().lerp(end, t);

    const n0 = seededNoise(seed + index * 19.17);
    const n1 = seededNoise(seed + index * 31.71);

    const endpointFactor = index === 0 || index === segments ? 0.35 : 1.0;

    const jitter = normalA
      .clone()
      .multiplyScalar((n0 - 0.5) * jitterAmount * endpointFactor)
      .add(
        normalB
          .clone()
          .multiplyScalar((n1 - 0.5) * jitterAmount * endpointFactor),
      );

    points.push(base.add(jitter));
  }

  return points;
}

function addPolylineAsSegments(
  positions: number[],
  pointsWorld: THREE.Vector3[],
  hostObject: THREE.Object3D,
) {
  for (let index = 0; index < pointsWorld.length - 1; index += 1) {
    const a = hostObject.worldToLocal(pointsWorld[index].clone());
    const b = hostObject.worldToLocal(pointsWorld[index + 1].clone());

    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

function createSketchPlaneLoop({
  object,
  measure,
  axis,
  sign,
  level,
  lineIndex,
  lineCount,
}: {
  object: THREE.Object3D;
  measure: FrameMeasure;
  axis: ConfidenceAxis;
  sign: number;
  level: ConfidenceLevel;
  lineIndex: number;
  lineCount: number;
}) {
  const [uAxisName, vAxisName] = getOtherFrameAxes(axis);

  const axisVector = measure.axes[axis];
  const uAxis = measure.axes[uAxisName];
  const vAxis = measure.axes[vAxisName];

  const axisExtent =
    sign > 0 ? measure.extents[axis].max : measure.extents[axis].min;

  const uMin = measure.extents[uAxisName].min;
  const uMax = measure.extents[uAxisName].max;
  const vMin = measure.extents[vAxisName].min;
  const vMax = measure.extents[vAxisName].max;

  const objectSize = Math.max(
    measure.extents.x.max - measure.extents.x.min,
    measure.extents.y.max - measure.extents.y.min,
    measure.extents.z.max - measure.extents.z.min,
    0.01,
  );

  const layerRatio = (lineIndex + 1) / lineCount;
  const offsetDistance =
    objectSize * getConfidenceOffsetMultiplier(level) * layerRatio;

  const jitterAmount =
    objectSize *
    getConfidenceJitterMultiplier(level) *
    (0.8 + layerRatio * 0.9);

  const planeCenter = measure.centerWorld
    .clone()
    .add(axisVector.clone().multiplyScalar(axisExtent + sign * offsetDistance));

  const padding = objectSize * (level === "low" ? 0.015 : 0.008) * layerRatio;

  const corners = [
    planeCenter
      .clone()
      .add(uAxis.clone().multiplyScalar(uMin - padding))
      .add(vAxis.clone().multiplyScalar(vMin - padding)),
    planeCenter
      .clone()
      .add(uAxis.clone().multiplyScalar(uMax + padding))
      .add(vAxis.clone().multiplyScalar(vMin - padding)),
    planeCenter
      .clone()
      .add(uAxis.clone().multiplyScalar(uMax + padding))
      .add(vAxis.clone().multiplyScalar(vMax + padding)),
    planeCenter
      .clone()
      .add(uAxis.clone().multiplyScalar(uMin - padding))
      .add(vAxis.clone().multiplyScalar(vMax + padding)),
  ];

  const positions: number[] = [];

  for (let edgeIndex = 0; edgeIndex < 4; edgeIndex += 1) {
    const start = corners[edgeIndex];
    const end = corners[(edgeIndex + 1) % 4];

    const sketchPoints = makeSketchyWorldSegmentPoints({
      start,
      end,
      jitterAmount,
      seed:
        axis.charCodeAt(0) * 1000 +
        sign * 100 +
        lineIndex * 37 +
        edgeIndex * 11,
    });

    addPolylineAsSegments(positions, sketchPoints, object);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const material = new THREE.LineDashedMaterial({
    color: getConfidenceLineColor(level),
    linewidth: 1,
    dashSize: objectSize * (level === "low" ? 0.025 : 0.04),
    gapSize: objectSize * (level === "low" ? 0.018 : 0.026),
    transparent: true,
    opacity: getConfidenceLineOpacity(level) * (1.0 - lineIndex * 0.12),
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(geometry, material);

  line.computeLineDistances();
  line.renderOrder = 1200 + lineIndex;
  line.userData[FUZZY_VISUAL_CHILD] = true;

  return line;
}

function createObjectLevelUncertaintySketch({
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

  const group = new THREE.Group();
  group.userData[FUZZY_VISUAL_CHILD] = true;

  (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
    const level = confidence[axis];
    const lineCount = getConfidenceLineCount(level);

    if (lineCount === 0) {
      return;
    }

    const signs = getDirectionSigns(directions[axis]);

    for (const sign of signs) {
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        group.add(
          createSketchPlaneLoop({
            object,
            measure,
            axis,
            sign,
            level,
            lineIndex,
            lineCount,
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






function applyUncertaintyToObject({
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
  if (!hasUncertainty(confidence)) {
    return;
  }

  object.updateWorldMatrix(true, true);

  const sketch = createObjectLevelUncertaintySketch({
    object,
    confidence,
    directions,
    axisFrame,
  });

  if (sketch) {
    object.add(sketch);
  }
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

  const annotationByPathKey = new Map(
    annotations.map((annotation) => [annotation.pathKey, annotation]),
  );

  const targetObjects = findTopLevelObjectsByPathKeys(
    scene,
    annotations.map((item) => item.pathKey),
  );

  for (const object of targetObjects) {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") {
      continue;
    }

    const annotation = annotationByPathKey.get(pathKey);

    if (!annotation) {
      continue;
    }

    applyUncertaintyToObject({
      object,
      confidence: annotation.confidence,
      directions: annotation.directions ?? DEFAULT_DIRECTIONS,
      axisFrame: axisFramesByPathKey?.get(pathKey) ?? DEFAULT_AXIS_FRAME,
    });
  }
}