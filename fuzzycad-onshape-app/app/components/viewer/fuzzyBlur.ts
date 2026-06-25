import * as THREE from "three";
import type {
  AxisConfidenceMap,
  ConfidenceAxis,
  ConfidenceLevel,
  FuzzyConfidenceAnnotation,
} from "../../lib/uncertainty/types";

export type { FuzzyConfidenceAnnotation };

const BLUR_GROUP_NAME = "__fuzzycad_confidence_blur__";

const WORLD_AXIS: Record<ConfidenceAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

function getBlurConfig(level: ConfidenceLevel) {
  if (level === "low") {
    return {
      layerCount: 6,
      spreadRatio: 0.12,
      opacity: 0.095,
    };
  }

  if (level === "medium") {
    return {
      layerCount: 3,
      spreadRatio: 0.055,
      opacity: 0.065,
    };
  }

  return null;
}

function getMaterialColor(material: THREE.Material) {
  const materialWithColor = material as THREE.Material & {
    color?: THREE.Color;
  };

  if (materialWithColor.color) {
    return materialWithColor.color.clone();
  }

  return new THREE.Color(0x6aa8ff);
}

function makeGhostMaterial(sourceMaterial: THREE.Material, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color: getMaterialColor(sourceMaterial),
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}

function prepareGhostObject(
  object: THREE.Object3D,
  pathKey: string,
  opacity: number,
) {
  const ghost = object.clone(true);

  ghost.traverse((child) => {
    child.userData.fuzzyPathKey = pathKey;
    child.userData.fuzzyBlurGhost = true;

    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const sourceMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    const ghostMaterials = sourceMaterials.map((material) =>
      makeGhostMaterial(material, opacity),
    );

    child.material = Array.isArray(child.material)
      ? ghostMaterials
      : ghostMaterials[0];
  });

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  object.updateMatrixWorld(true);
  object.matrixWorld.decompose(position, quaternion, scale);

  ghost.position.copy(position);
  ghost.quaternion.copy(quaternion);
  ghost.scale.copy(scale);
  ghost.matrixAutoUpdate = true;

  return ghost;
}

function disposeBlurGroup(group: THREE.Object3D) {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      material.dispose();
    }
  });
}

function clearExistingBlur(scene: THREE.Object3D) {
  const existingGroups: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (object.name === BLUR_GROUP_NAME) {
      existingGroups.push(object);
    }
  });

  for (const group of existingGroups) {
    group.parent?.remove(group);
    disposeBlurGroup(group);
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

    if (object.userData?.fuzzyBlurGhost) {
      return;
    }

    objects.push(object);
  });

  return objects;
}

function getAxisSize(object: THREE.Object3D, axis: ConfidenceAxis) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();

  box.getSize(size);

  if (axis === "x") {
    return Math.max(size.x, 0.001);
  }

  if (axis === "y") {
    return Math.max(size.y, 0.001);
  }

  return Math.max(size.z, 0.001);
}

function addAxisBlurLayers({
  group,
  object,
  pathKey,
  axis,
  level,
}: {
  group: THREE.Group;
  object: THREE.Object3D;
  pathKey: string;
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
}) {
  const config = getBlurConfig(level);

  if (!config) {
    return;
  }

  const axisWorld = WORLD_AXIS[axis];
  const axisSize = getAxisSize(object, axis);
  const spread = axisSize * config.spreadRatio;

  for (let index = -config.layerCount; index <= config.layerCount; index += 1) {
    if (index === 0) {
      continue;
    }

    const distanceRatio = Math.abs(index) / config.layerCount;
    const opacity = config.opacity * (1.05 - distanceRatio * 0.55);
    const offset = axisWorld.clone().multiplyScalar(spread * index);

    const ghost = prepareGhostObject(object, pathKey, opacity);

    ghost.position.add(offset);
    group.add(ghost);
  }
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
) {
  clearExistingBlur(scene);

  if (annotations.length === 0) {
    return;
  }

  const blurGroup = new THREE.Group();

  blurGroup.name = BLUR_GROUP_NAME;
  blurGroup.userData.fuzzyBlurGhost = true;

  const targetObjects = findTopLevelObjectsByPathKeys(
    scene,
    annotations.map((item) => item.pathKey),
  );

  const objectByPathKey = new Map<string, THREE.Object3D>();

  for (const object of targetObjects) {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey === "string" && !objectByPathKey.has(pathKey)) {
      objectByPathKey.set(pathKey, object);
    }
  }

  for (const annotation of annotations) {
    const object = objectByPathKey.get(annotation.pathKey);

    if (!object) {
      continue;
    }

    const confidence: AxisConfidenceMap = annotation.confidence;

    addAxisBlurLayers({
      group: blurGroup,
      object,
      pathKey: annotation.pathKey,
      axis: "x",
      level: confidence.x,
    });

    addAxisBlurLayers({
      group: blurGroup,
      object,
      pathKey: annotation.pathKey,
      axis: "y",
      level: confidence.y,
    });

    addAxisBlurLayers({
      group: blurGroup,
      object,
      pathKey: annotation.pathKey,
      axis: "z",
      level: confidence.z,
    });
  }

  scene.add(blurGroup);
}