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

type HatchLayerSpec = {
  axis: ConfidenceAxis;
  level: UncertaintyVisualLevel;
  direction: ConfidenceDirection;
  layerIndex: number;
  layerCount: number;
  axisWorld: THREE.Vector3;
  hatchDirectionWorld: THREE.Vector3;
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
    opacity: level === "low" ? 0.22 : 0.55,
    depthWrite: false,
    depthTest: true,
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

    child.renderOrder = level === "low" ? 850 : 820;
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

function collectSourceMeshes(object: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    meshes.push(child);
  });

  return meshes;
}

function getFrameAxes(axisFrame: ConfidenceAxisFrame) {
  return {
    x: new THREE.Vector3(...axisFrame.x).normalize(),
    y: new THREE.Vector3(...axisFrame.y).normalize(),
    z: new THREE.Vector3(...axisFrame.z).normalize(),
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

function directionToMode(direction: ConfidenceDirection) {
  if (direction === "positive") {
    return 1.0;
  }

  if (direction === "negative") {
    return -1.0;
  }

  return 0.0;
}

function getHatchColor(level: UncertaintyVisualLevel) {
  if (level === "low") {
    return new THREE.Color(0x0f172a);
  }

  return new THREE.Color(0x334155);
}

function getHatchLayerCount(level: ConfidenceLevel) {
  if (level === "low") {
    return 2;
  }

  if (level === "medium") {
    return 1;
  }

  return 0;
}

function getHatchOpacity(level: UncertaintyVisualLevel, layerIndex: number) {
  if (level === "low") {
    return Math.max(0.26, 0.42 - layerIndex * 0.08);
  }

  return 0.24;
}

function getHatchLineWidth(level: UncertaintyVisualLevel) {
  return level === "low" ? 0.055 : 0.035;
}

function getHatchSoftness(level: UncertaintyVisualLevel) {
  return level === "low" ? 0.055 : 0.045;
}

function getObjectWorldSize(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();

  box.getSize(size);

  return Math.max(size.x, size.y, size.z, 0.01);
}

function makeHatchDirection({
  axis,
  axisFrame,
  layerIndex,
}: {
  axis: ConfidenceAxis;
  axisFrame: ConfidenceAxisFrame;
  layerIndex: number;
}) {
  const axes = getFrameAxes(axisFrame);
  const [uAxisName, vAxisName] = getOtherFrameAxes(axis);

  const uAxis = axes[uAxisName];
  const vAxis = axes[vAxisName];

  if (layerIndex % 2 === 0) {
    return uAxis.clone().multiplyScalar(0.92).add(vAxis.clone().multiplyScalar(0.38)).normalize();
  }

  return uAxis.clone().multiplyScalar(0.68).add(vAxis.clone().multiplyScalar(-0.74)).normalize();
}

function buildHatchLayerSpecs({
  confidence,
  directions,
  axisFrame,
}: {
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  axisFrame: ConfidenceAxisFrame;
}) {
  const axes = getFrameAxes(axisFrame);
  const specs: HatchLayerSpec[] = [];

  (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
    const confidenceLevel = confidence[axis];
    const layerCount = getHatchLayerCount(confidenceLevel);

    if (layerCount === 0) {
      return;
    }

    const visualLevel: UncertaintyVisualLevel =
      confidenceLevel === "low" ? "low" : "medium";

    for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
      specs.push({
        axis,
        level: visualLevel,
        direction: directions[axis],
        layerIndex,
        layerCount,
        axisWorld: axes[axis],
        hatchDirectionWorld: makeHatchDirection({
          axis,
          axisFrame,
          layerIndex,
        }),
      });
    }
  });

  return specs;
}

function makeHatchMaterial({
  objectCenterWorld,
  objectSize,
  spec,
}: {
  objectCenterWorld: THREE.Vector3;
  objectSize: number;
  spec: HatchLayerSpec;
}) {
  const opacity = getHatchOpacity(spec.level, spec.layerIndex);
  const frequencyBase = spec.level === "low" ? 42 : 24;
  const frequency = frequencyBase / Math.max(objectSize, 0.01);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uObjectCenterWorld: {
        value: objectCenterWorld.clone(),
      },
      uAxisWorld: {
        value: spec.axisWorld.clone().normalize(),
      },
      uHatchDirectionWorld: {
        value: spec.hatchDirectionWorld.clone().normalize(),
      },
      uDirectionMode: {
        value: directionToMode(spec.direction),
      },
      uFrequency: {
        value: frequency,
      },
      uLineWidth: {
        value: getHatchLineWidth(spec.level),
      },
      uSoftness: {
        value: getHatchSoftness(spec.level),
      },
      uOpacity: {
        value: opacity,
      },
      uColor: {
        value: getHatchColor(spec.level),
      },
      uLayerOffset: {
        value: spec.layerIndex * 0.37 + spec.axis.charCodeAt(0) * 0.013,
      },
      uNoiseStrength: {
        value: spec.level === "low" ? 0.08 : 0.025,
      },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying float vDirectionAllowed;

      uniform vec3 uObjectCenterWorld;
      uniform vec3 uAxisWorld;
      uniform float uDirectionMode;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);

        vWorldPosition = worldPosition.xyz;

        float axisCoordinate = dot(vWorldPosition - uObjectCenterWorld, uAxisWorld);
        float directionAllowed = 1.0;

        if (uDirectionMode > 0.5) {
          directionAllowed = axisCoordinate >= 0.0 ? 1.0 : 0.0;
        } else if (uDirectionMode < -0.5) {
          directionAllowed = axisCoordinate <= 0.0 ? 1.0 : 0.0;
        }

        vDirectionAllowed = directionAllowed;

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      varying float vDirectionAllowed;

      uniform vec3 uHatchDirectionWorld;
      uniform float uFrequency;
      uniform float uLineWidth;
      uniform float uSoftness;
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform float uLayerOffset;
      uniform float uNoiseStrength;

      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }

      void main() {
        if (vDirectionAllowed < 0.5) {
          discard;
        }

        float coordinate = dot(vWorldPosition, uHatchDirectionWorld) * uFrequency;
        float cell = floor(coordinate);
        float local = fract(coordinate + uLayerOffset);

        float n1 = hash(cell * 17.13 + uLayerOffset * 11.7);
        float n2 = hash(cell * 31.71 + uLayerOffset * 23.3);

        float wobble = (n1 - 0.5) * uNoiseStrength;
        float widthVariation = mix(0.82, 1.18, n2);

        float distanceToCenter = abs(local - 0.5 + wobble);
        float lineMask =
          1.0 - smoothstep(
            uLineWidth * widthVariation,
            uLineWidth * widthVariation + uSoftness,
            distanceToCenter
          );

        float alpha = lineMask * uOpacity;

        if (alpha < 0.012) {
          discard;
        }

        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;

  return material;
}

function createHatchOverlayMesh({
  sourceMesh,
  objectCenterWorld,
  objectSize,
  spec,
}: {
  sourceMesh: THREE.Mesh;
  objectCenterWorld: THREE.Vector3;
  objectSize: number;
  spec: HatchLayerSpec;
}) {
  const overlayGeometry = sourceMesh.geometry.clone();

  const overlay = new THREE.Mesh(
    overlayGeometry,
    makeHatchMaterial({
      objectCenterWorld,
      objectSize,
      spec,
    }),
  );

  overlay.renderOrder = spec.level === "low" ? 1250 + spec.layerIndex : 1150;
  overlay.frustumCulled = false;
  overlay.userData[FUZZY_VISUAL_CHILD] = true;

  return overlay;
}

function addHatchOverlayToObject({
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
  const meshes = collectSourceMeshes(object);

  if (meshes.length === 0) {
    return;
  }

  const objectBox = new THREE.Box3().setFromObject(object);
  const objectCenterWorld = new THREE.Vector3();

  objectBox.getCenter(objectCenterWorld);

  const objectSize = getObjectWorldSize(object);

  const layerSpecs = buildHatchLayerSpecs({
    confidence,
    directions,
    axisFrame,
  });

  for (const sourceMesh of meshes) {
    for (const spec of layerSpecs) {
      const overlay = createHatchOverlayMesh({
        sourceMesh,
        objectCenterWorld,
        objectSize,
        spec,
      });

      sourceMesh.add(overlay);
    }
  }
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

  const visualLevel = getObjectVisualLevel(confidence);

  if (visualLevel === "low") {
    applyDraftSurface(object, visualLevel);
  }

  addHatchOverlayToObject({
    object,
    confidence,
    directions,
    axisFrame,
  });
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