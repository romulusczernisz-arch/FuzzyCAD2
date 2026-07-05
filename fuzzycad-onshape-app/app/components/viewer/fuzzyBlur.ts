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

type FrameMeasure = {
  centerWorld: THREE.Vector3;
  axes: Record<ConfidenceAxis, THREE.Vector3>;
  extents: Record<ConfidenceAxis, { min: number; max: number }>;
  objectSize: number;
};

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

function getObjectVisualLevel(
  confidence: AxisConfidenceMap,
): UncertaintyVisualLevel {
  return getMaxUncertainty(confidence) >= 1 ? "low" : "medium";
}

function getMeshMaterials(mesh: THREE.Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function getMaterialColor(material: THREE.Material) {
  const materialWithColor = material as THREE.MeshStandardMaterial;

  if (materialWithColor.color) {
    return materialWithColor.color.clone();
  }

  return new THREE.Color(0x9ca3af);
}

function makeDraftSurfaceMaterial(
  sourceMaterial: THREE.Material,
  level: UncertaintyVisualLevel,
) {
  const source = sourceMaterial as THREE.MeshStandardMaterial;

  const material = new THREE.MeshStandardMaterial({
    color: getMaterialColor(sourceMaterial),
    map: source.map ?? null,
    transparent: true,
    opacity: level === "low" ? 0.26 : 0.52,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;

  return material;
}

function applyDraftSurface(object: THREE.Object3D, level: UncertaintyVisualLevel) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const currentMaterials = getMeshMaterials(child);

    if (!child.userData[FUZZY_ORIGINAL_MATERIALS]) {
      child.userData[FUZZY_ORIGINAL_MATERIALS] = currentMaterials;
    }

    const draftMaterials = currentMaterials.map((material) =>
      makeDraftSurfaceMaterial(material, level),
    );

    child.material = Array.isArray(child.material)
      ? draftMaterials
      : draftMaterials[0];

    child.renderOrder = level === "low" ? 900 : 850;
  });
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

function getFrameAxes(axisFrame: ConfidenceAxisFrame) {
  return {
    x: new THREE.Vector3(...axisFrame.x).normalize(),
    y: new THREE.Vector3(...axisFrame.y).normalize(),
    z: new THREE.Vector3(...axisFrame.z).normalize(),
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

function seededNoise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
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

  const objectSize = Math.max(
    extents.x.max - extents.x.min,
    extents.y.max - extents.y.min,
    extents.z.max - extents.z.min,
    0.01,
  );

  return {
    centerWorld,
    axes,
    extents,
    objectSize,
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

function makeDraftStrokePoints({
  start,
  end,
  jitterAmount,
  seed,
  segments = 8,
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

    const n0 = seededNoise(seed + index * 17.11);
    const n1 = seededNoise(seed + index * 29.73);

    const endFade = index === 0 || index === segments ? 0.25 : 1.0;

    const jitter = normalA
      .clone()
      .multiplyScalar((n0 - 0.5) * jitterAmount * endFade)
      .add(
        normalB
          .clone()
          .multiplyScalar((n1 - 0.5) * jitterAmount * endFade),
      );

    points.push(base.add(jitter));
  }

  return points;
}

function addSketchSegment({
  positions,
  object,
  startWorld,
  endWorld,
  jitterAmount,
  seed,
}: {
  positions: number[];
  object: THREE.Object3D;
  startWorld: THREE.Vector3;
  endWorld: THREE.Vector3;
  jitterAmount: number;
  seed: number;
}) {
  const points = makeDraftStrokePoints({
    start: startWorld,
    end: endWorld,
    jitterAmount,
    seed,
  });

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = object.worldToLocal(points[index].clone());
    const b = object.worldToLocal(points[index + 1].clone());

    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

function addCrossHatchOnSleeve({
  positions,
  object,
  measure,
  uncertaintyAxis,
  uAxisName,
  vAxisName,
  fromDimension,
  toDimension,
  u0,
  u1,
  v0,
  v1,
  level,
  jitterAmount,
  seed,
}: {
  positions: number[];
  object: THREE.Object3D;
  measure: FrameMeasure;
  uncertaintyAxis: ConfidenceAxis;
  uAxisName: ConfidenceAxis;
  vAxisName: ConfidenceAxis;
  fromDimension: number;
  toDimension: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  level: UncertaintyVisualLevel;
  jitterAmount: number;
  seed: number;
}) {
  const dimensionLength = Math.abs(toDimension - fromDimension);
  const crossSize = Math.max(Math.abs(u1 - u0), Math.abs(v1 - v0), 0.01);

  // 用真实 spacing 控制密度，body 和 extension 共享同一个 spacing 逻辑。
  const spacing =
    crossSize * (level === "low" ? 0.55 : 0.85);

  const hatchCount = Math.max(3, Math.ceil(dimensionLength / spacing));

  for (let index = 0; index <= hatchCount; index += 1) {
    const t = hatchCount === 0 ? 0 : index / hatchCount;

    const dimension = THREE.MathUtils.lerp(fromDimension, toDimension, t);

    // 关键：hatch 不沿 dimensionAxis 画，只在 u/v 截面方向画短斜线。
    // 这样它不会顺着腿的长边变成一堆长平行线。
    const drift = ((index % 3) - 1) * crossSize * 0.08;

    const startWorld = makeFramePoint({
      measure,
      dimensionAxis: uncertaintyAxis,
      uAxisName,
      vAxisName,
      dimension,
      u: u0 + drift,
      v: v0,
    });

    const endWorld = makeFramePoint({
      measure,
      dimensionAxis: uncertaintyAxis,
      uAxisName,
      vAxisName,
      dimension,
      u: u1 + drift,
      v: v1,
    });

    addSketchSegment({
      positions,
      object,
      startWorld,
      endWorld,
      jitterAmount: jitterAmount * (level === "low" ? 0.75 : 0.42),
      seed: seed + index * 17,
    });
  }
}

function makeFramePoint({
  measure,
  dimensionAxis,
  uAxisName,
  vAxisName,
  dimension,
  u,
  v,
}: {
  measure: FrameMeasure;
  dimensionAxis: ConfidenceAxis;
  uAxisName: ConfidenceAxis;
  vAxisName: ConfidenceAxis;
  dimension: number;
  u: number;
  v: number;
}) {
  return measure.centerWorld
    .clone()
    .add(measure.axes[dimensionAxis].clone().multiplyScalar(dimension))
    .add(measure.axes[uAxisName].clone().multiplyScalar(u))
    .add(measure.axes[vAxisName].clone().multiplyScalar(v));
}

function createAbstractObjectSketchStrokeLayer({
  object,
  measure,
  uncertaintyAxis,
  sign,
  level,
  extensionAmount,
  jitterAmount,
  seed,
}: {
  object: THREE.Object3D;
  measure: FrameMeasure;
  uncertaintyAxis: ConfidenceAxis;
  sign: number;
  level: UncertaintyVisualLevel;
  extensionAmount: number;
  jitterAmount: number;
  seed: number;
}) {
  const [uAxisName, vAxisName] = getOtherFrameAxes(uncertaintyAxis);

  const originalMin = measure.extents[uncertaintyAxis].min;
  const originalMax = measure.extents[uncertaintyAxis].max;

  const originalBoundary = sign > 0 ? originalMax : originalMin;
  const uncertainBoundary = originalBoundary + sign * extensionAmount;

  // 不加 padding，保证 hatch sleeve 的粗细和原 geo 一样。
  const u0 = measure.extents[uAxisName].min;
  const u1 = measure.extents[uAxisName].max;
  const v0 = measure.extents[vAxisName].min;
  const v1 = measure.extents[vAxisName].max;

  const positions: number[] = [];

  const capAt = (dimension: number) => [
    makeFramePoint({
      measure,
      dimensionAxis: uncertaintyAxis,
      uAxisName,
      vAxisName,
      dimension,
      u: u0,
      v: v0,
    }),
    makeFramePoint({
      measure,
      dimensionAxis: uncertaintyAxis,
      uAxisName,
      vAxisName,
      dimension,
      u: u1,
      v: v0,
    }),
    makeFramePoint({
      measure,
      dimensionAxis: uncertaintyAxis,
      uAxisName,
      vAxisName,
      dimension,
      u: u1,
      v: v1,
    }),
    makeFramePoint({
      measure,
      dimensionAxis: uncertaintyAxis,
      uAxisName,
      vAxisName,
      dimension,
      u: u0,
      v: v1,
    }),
  ];

  const originalStartCap = capAt(originalMin);
  const originalEndCap = capAt(originalMax);
  const originalBoundaryCap = capAt(originalBoundary);
  const uncertainCap = capAt(uncertainBoundary);

  // 1) Original body rails：让中间原 object 也有 sketch 结构。
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: originalStartCap[index],
      endWorld: originalEndCap[index],
      jitterAmount: jitterAmount * 0.45,
      seed: seed + 10 + index * 17,
    });
  }

  // 2) Original body hatch.
  // hatch 横切 selected dimension，不沿长边方向跑。
  addCrossHatchOnSleeve({
    positions,
    object,
    measure,
    uncertaintyAxis,
    uAxisName,
    vAxisName,
    fromDimension: originalMin,
    toDimension: originalMax,
    u0,
    u1,
    v0,
    v1,
    level,
    jitterAmount,
    seed: seed + 200,
  });

  // 3) Connector from original boundary to uncertain boundary.
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: originalBoundaryCap[index],
      endWorld: uncertainCap[index],
      jitterAmount: jitterAmount * 0.65,
      seed: seed + 500 + index * 17,
    });
  }

  // 4) Uncertain cap outline.
  for (let index = 0; index < 4; index += 1) {
    addSketchSegment({
      positions,
      object,
      startWorld: uncertainCap[index],
      endWorld: uncertainCap[(index + 1) % 4],
      jitterAmount,
      seed: seed + 700 + index * 19,
    });
  }

  // 5) Extension hatch.
  // 和 body 使用同一种 spacing 逻辑，所以密度不会突然变。
  addCrossHatchOnSleeve({
    positions,
    object,
    measure,
    uncertaintyAxis,
    uAxisName,
    vAxisName,
    fromDimension: originalBoundary,
    toDimension: uncertainBoundary,
    u0,
    u1,
    v0,
    v1,
    level,
    jitterAmount,
    seed: seed + 900,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.LineBasicMaterial({
    color: level === "low" ? 0x0f172a : 0x475569,
    transparent: true,
    opacity: level === "low" ? 0.64 : 0.42,
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(geometry, material);

  line.renderOrder = level === "low" ? 1300 : 1200;
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

  const level = getObjectVisualLevel(confidence);
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  const activeAxes = (["x", "y", "z"] as ConfidenceAxis[]).filter(
    (axis) => confidence[axis] !== "high",
  );

  for (const axis of activeAxes) {
    const axisLevel = confidence[axis];
    const visualLevel: UncertaintyVisualLevel =
      axisLevel === "low" ? "low" : "medium";

    const signs = getDirectionSigns(directions[axis]);

    // low = 多个 possible extent，medium = 一个 possible extent。
    const lineCount = axisLevel === "low" ? 3 : 1;

    const axisLength =
      measure.extents[axis].max - measure.extents[axis].min;

    for (const sign of signs) {
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        const layerRatio = (lineIndex + 1) / lineCount;

        // 这里的 extension 是沿 selected dimension 的长度变化；
        // 不影响另外两个方向的“粗细”。
        const extensionAmount =
          Math.max(axisLength, measure.objectSize * 0.2) *
          (axisLevel === "low" ? 0.22 : 0.1) *
          layerRatio;

        const jitterAmount =
          measure.objectSize *
          (axisLevel === "low" ? 0.0045 : 0.002) *
          (1 + layerRatio);

        const sketch = createAbstractObjectSketchStrokeLayer({
          object,
          measure,
          uncertaintyAxis: axis,
          sign,
          level: visualLevel,
          extensionAmount,
          jitterAmount,
          seed:
            axis.charCodeAt(0) * 1000 +
            sign * 100 +
            lineIndex * 31,
        });

        group.add(sketch);
      }
    }
  }

  if (group.children.length === 0) {
    return null;
  }

  return {
    group,
    level,
  };
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

  const representation = createObjectLineArtRepresentation({
    object,
    confidence,
    directions,
    axisFrame,
  });

  if (!representation) {
    return;
  }

  if (representation.level === "low") {
    applyDraftSurface(object, "low");
  }

  object.add(representation.group);
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