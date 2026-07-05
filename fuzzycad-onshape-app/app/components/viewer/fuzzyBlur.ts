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

function getObjectVisualLevel(confidence: AxisConfidenceMap): UncertaintyVisualLevel {
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

function getObjectWorldSize(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();

  box.getSize(size);

  return Math.max(size.x, size.y, size.z, 0.01);
}

function getGeometryRadius(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingSphere();

  return Math.max(geometry.boundingSphere?.radius ?? 0.05, 0.01);
}

function worldVectorToObjectLocal(
  object: THREE.Object3D,
  vectorWorld: THREE.Vector3,
) {
  const inverseWorld = object.matrixWorld.clone().invert();

  return vectorWorld
    .clone()
    .normalize()
    .transformDirection(inverseWorld)
    .normalize();
}

function createJitteredEdgeGeometry(input: {
  source: THREE.BufferGeometry;
  jitterAmount: number;
  seed: number;
}) {
  const position = input.source.getAttribute("position");

  if (!position || input.jitterAmount <= 0) {
    return input.source.clone();
  }

  const points: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  for (let index = 0; index < position.count; index += 2) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);

    const tangent = b.clone().sub(a);

    if (tangent.lengthSq() < 1e-12) {
      continue;
    }

    tangent.normalize();

    const helper =
      Math.abs(tangent.y) < 0.85
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);

    const normalA = new THREE.Vector3()
      .crossVectors(tangent, helper)
      .normalize();

    const normalB = new THREE.Vector3()
      .crossVectors(tangent, normalA)
      .normalize();

    const n0 = seededNoise(input.seed + index * 13.17);
    const n1 = seededNoise(input.seed + index * 17.31);
    const n2 = seededNoise(input.seed + index * 23.47);
    const n3 = seededNoise(input.seed + index * 29.91);

    const jitterStart = normalA
      .clone()
      .multiplyScalar((n0 - 0.5) * input.jitterAmount)
      .add(normalB.clone().multiplyScalar((n1 - 0.5) * input.jitterAmount));

    const jitterEnd = normalA
      .clone()
      .multiplyScalar((n2 - 0.5) * input.jitterAmount)
      .add(normalB.clone().multiplyScalar((n3 - 0.5) * input.jitterAmount));

    const aa = a.clone().add(jitterStart);
    const bb = b.clone().add(jitterEnd);

    points.push(aa.x, aa.y, aa.z, bb.x, bb.y, bb.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));

  return geometry;
}

function makeLineMaterial(input: {
  level: UncertaintyVisualLevel;
  opacity: number;
  variant: "base" | "sketch";
}) {
  return new THREE.LineBasicMaterial({
    color:
      input.variant === "base"
        ? input.level === "low"
          ? 0x111827
          : 0x334155
        : input.level === "low"
          ? 0x0f172a
          : 0x475569,
    transparent: true,
    opacity: input.opacity,
    depthTest: false,
    depthWrite: false,
  });
}

function getChildMatrixRelativeToObject(
  object: THREE.Object3D,
  child: THREE.Object3D,
) {
  return new THREE.Matrix4().multiplyMatrices(
    object.matrixWorld.clone().invert(),
    child.matrixWorld,
  );
}

function createObjectEdgeLayer({
  object,
  level,
  jitterAmount,
  opacity,
  renderOrder,
  variant,
  seed,
}: {
  object: THREE.Object3D;
  level: UncertaintyVisualLevel;
  jitterAmount: number;
  opacity: number;
  renderOrder: number;
  variant: "base" | "sketch";
  seed: number;
}) {
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  object.updateWorldMatrix(true, true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const edgeGeometry = new THREE.EdgesGeometry(
      child.geometry,
      level === "low" ? 58 : 70,
    );

    const radius = getGeometryRadius(child.geometry);
    const sketchGeometry = createJitteredEdgeGeometry({
      source: edgeGeometry,
      jitterAmount: radius * jitterAmount,
      seed: seed + child.id * 9.13,
    });

    edgeGeometry.dispose();

    const material = makeLineMaterial({
      level,
      opacity,
      variant,
    });

    const line = new THREE.LineSegments(sketchGeometry, material);

    line.matrix.copy(getChildMatrixRelativeToObject(object, child));
    line.matrixAutoUpdate = false;
    line.renderOrder = renderOrder;
    line.userData[FUZZY_VISUAL_CHILD] = true;

    group.add(line);
  });

  if (group.children.length === 0) {
    return null;
  }

  return group;
}

function getUncertainAxisOffsets({
  object,
  confidence,
  directions,
  axisFrame,
  level,
}: {
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  axisFrame: ConfidenceAxisFrame;
  level: UncertaintyVisualLevel;
}) {
  const axes = getFrameAxes(axisFrame);
  const objectSize = getObjectWorldSize(object);
  const offsets: {
    axis: ConfidenceAxis;
    axisLevel: ConfidenceLevel;
    localOffset: THREE.Vector3;
    layerIndex: number;
    layerCount: number;
  }[] = [];

  (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
    const axisLevel = confidence[axis];

    if (axisLevel === "high") {
      return;
    }

    const signs = getDirectionSigns(directions[axis]);
    const perSideLayerCount = axisLevel === "low" ? 2 : 1;
    const baseAmount =
      objectSize * (axisLevel === "low" ? 0.012 : 0.006);

    for (const sign of signs) {
      for (let layerIndex = 0; layerIndex < perSideLayerCount; layerIndex += 1) {
        const amount = baseAmount * (layerIndex + 1);
        const worldOffset = axes[axis].clone().multiplyScalar(sign * amount);
        const localOffset = worldVectorToObjectLocal(object, worldOffset)
          .multiplyScalar(worldOffset.length());

        offsets.push({
          axis,
          axisLevel,
          localOffset,
          layerIndex,
          layerCount: perSideLayerCount,
        });
      }
    }
  });

  if (offsets.length === 0 && level === "low") {
    offsets.push({
      axis: "x",
      axisLevel: "low",
      localOffset: new THREE.Vector3(objectSize * 0.01, 0, 0),
      layerIndex: 0,
      layerCount: 1,
    });
  }

  return offsets;
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
  const level = getObjectVisualLevel(confidence);
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  const baseLayer = createObjectEdgeLayer({
    object,
    level,
    jitterAmount: level === "low" ? 0.0025 : 0,
    opacity: level === "low" ? 0.64 : 0.5,
    renderOrder: level === "low" ? 1200 : 1100,
    variant: "base",
    seed: 17,
  });

  if (baseLayer) {
    group.add(baseLayer);
  }

  const offsets = getUncertainAxisOffsets({
    object,
    confidence,
    directions,
    axisFrame,
    level,
  });

  offsets.forEach((offset, index) => {
    const axisVisualLevel: UncertaintyVisualLevel =
      offset.axisLevel === "low" ? "low" : "medium";

    const sketchLayer = createObjectEdgeLayer({
      object,
      level: axisVisualLevel,
      jitterAmount: axisVisualLevel === "low" ? 0.008 : 0.0035,
      opacity:
        axisVisualLevel === "low"
          ? 0.82 - offset.layerIndex * 0.14
          : 0.58,
      renderOrder: 1250 + index,
      variant: "sketch",
      seed: 1000 + index * 37 + offset.axis.charCodeAt(0),
    });

    if (!sketchLayer) {
      return;
    }

    sketchLayer.position.copy(offset.localOffset);

    if (axisVisualLevel === "low") {
      const sign = index % 2 === 0 ? 1 : -1;
      sketchLayer.rotation.x += 0.004 * sign * (offset.layerIndex + 1);
      sketchLayer.rotation.y -= 0.003 * sign * (offset.layerIndex + 1);
    }

    group.add(sketchLayer);
  });

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