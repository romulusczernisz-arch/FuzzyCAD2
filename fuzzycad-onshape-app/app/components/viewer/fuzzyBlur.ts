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

const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";
const FUZZY_VISUAL_CHILD = "__fuzzycad_uncertainty_visual_child__";

const DEFAULT_DIRECTIONS: AxisDirectionMap = {
  x: "both",
  y: "both",
  z: "both",
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

function getLayerCount(level: ConfidenceLevel) {
  if (level === "low") {
    return 3;
  }

  if (level === "medium") {
    return 1;
  }

  return 0;
}

function getWorldAxis(axis: ConfidenceAxis) {
  if (axis === "x") {
    return new THREE.Vector3(1, 0, 0);
  }

  if (axis === "y") {
    return new THREE.Vector3(0, 1, 0);
  }

  return new THREE.Vector3(0, 0, 1);
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

function getShellColor(level: ConfidenceLevel) {
  if (level === "low") {
    return new THREE.Color(0x1455ff);
  }

  return new THREE.Color(0x9edcff);
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

function makeDimmedOriginalMaterial(
  sourceMaterial: THREE.Material,
  strength: number,
) {
  const source = sourceMaterial as THREE.MeshStandardMaterial;

  const material = new THREE.MeshStandardMaterial({
    color: getMaterialColor(sourceMaterial),
    map: source.map ?? null,
    transparent: true,
    opacity: strength >= 1 ? 0.07 : 0.15,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;

  return material;
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

function dimOriginalMesh(mesh: THREE.Mesh, strength: number) {
  const currentMaterials = getMeshMaterials(mesh);

  if (!mesh.userData[FUZZY_ORIGINAL_MATERIALS]) {
    mesh.userData[FUZZY_ORIGINAL_MATERIALS] = currentMaterials;
  }

  const dimmedMaterials = currentMaterials.map((material) =>
    makeDimmedOriginalMaterial(material, strength),
  );

  mesh.material = Array.isArray(mesh.material)
    ? dimmedMaterials
    : dimmedMaterials[0];
}

function createDashedBoundary(mesh: THREE.Mesh, strength: number) {
  const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 40);

  const material = new THREE.LineDashedMaterial({
    color: 0x111111,
    linewidth: 1,
    dashSize: strength >= 1 ? 0.095 : 0.115,
    gapSize: strength >= 1 ? 0.14 : 0.17,
    transparent: true,
    opacity: strength >= 1 ? 0.9 : 0.6,
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(edgeGeometry, material);

  line.computeLineDistances();
  line.renderOrder = 1000;
  line.userData[FUZZY_VISUAL_CHILD] = true;

  return line;
}

function makeAxisShellMaterial({
  objectCenterWorld,
  axis,
  level,
  direction,
  layerIndex,
  layerCount,
}: {
  objectCenterWorld: THREE.Vector3;
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
  direction: ConfidenceDirection;
  layerIndex: number;
  layerCount: number;
}) {
  const strength = confidenceToStrength(level);
  const worldAxis = getWorldAxis(axis);
  const color = getShellColor(level);
  const layerRatio = layerIndex / Math.max(layerCount - 1, 1);
  const directionMode = directionToMode(direction);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uWorldAxis: {
        value: worldAxis,
      },
      uObjectCenterWorld: {
        value: objectCenterWorld,
      },
      uStrength: {
        value: strength,
      },
      uLayerRatio: {
        value: layerRatio,
      },
      uColor: {
        value: color,
      },
      uIsLow: {
        value: level === "low" ? 1.0 : 0.0,
      },
      uDirectionMode: {
        value: directionMode,
      },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying float vAxisPresence;
      varying float vDirectionAllowed;

      uniform vec3 uWorldAxis;
      uniform vec3 uObjectCenterWorld;
      uniform float uStrength;
      uniform float uLayerRatio;
      uniform float uIsLow;
      uniform float uDirectionMode;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec3 transformedWorldPosition = worldPosition.xyz;

        vec3 fromCenter = worldPosition.xyz - uObjectCenterWorld;
        float axisCoordinate = dot(fromCenter, uWorldAxis);
        float axisSign = axisCoordinate >= 0.0 ? 1.0 : -1.0;

        float directionAllowed = 1.0;

        if (uDirectionMode > 0.5) {
          directionAllowed = axisSign > 0.0 ? 1.0 : 0.0;
        } else if (uDirectionMode < -0.5) {
          directionAllowed = axisSign < 0.0 ? 1.0 : 0.0;
        }

        // Medium: visible but close to the object.
        // Low: wider unresolved range.
        float baseExpansion = mix(0.002, 0.008, uLayerRatio) * uStrength;
        float axisExpansion = mix(0.011, 0.06, uLayerRatio) * uStrength;

        axisExpansion *= mix(0.75, 1.0, uIsLow);

        vec3 safeFromCenter = normalize(fromCenter + vec3(0.0001));

        transformedWorldPosition += safeFromCenter * baseExpansion * directionAllowed;
        transformedWorldPosition += uWorldAxis * axisSign * axisExpansion * directionAllowed;

        vec3 normalizedFromCenter = normalize(abs(fromCenter) + vec3(0.0001));
        vec3 absAxis = abs(uWorldAxis);

        vAxisPresence = dot(normalizedFromCenter, absAxis);
        vDirectionAllowed = directionAllowed;

        gl_Position = projectionMatrix * viewMatrix * vec4(transformedWorldPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      varying float vAxisPresence;
      varying float vDirectionAllowed;

      uniform float uStrength;
      uniform float uLayerRatio;
      uniform vec3 uColor;
      uniform float uIsLow;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.13, 0.37, 0.61));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);

        f = f * f * (3.0 - 2.0 * f);

        float n000 = hash(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash(i + vec3(1.0, 1.0, 1.0));

        float nx00 = mix(n000, n100, f.x);
        float nx10 = mix(n010, n110, f.x);
        float nx01 = mix(n001, n101, f.x);
        float nx11 = mix(n011, n111, f.x);

        float nxy0 = mix(nx00, nx10, f.y);
        float nxy1 = mix(nx01, nx11, f.y);

        return mix(nxy0, nxy1, f.z);
      }

      void main() {
        if (vDirectionAllowed < 0.5) {
          discard;
        }

        float axisMask = smoothstep(0.12, 0.78, vAxisPresence);

        if (axisMask < 0.018) {
          discard;
        }

        float n1 = noise(gl_FragCoord.xyz * 0.035);
        float n2 = noise(gl_FragCoord.xyz * 0.085 + vec3(3.7, 8.1, 2.4));
        float n = mix(n1, n2, 0.45);

        float particleMask = smoothstep(0.16, 0.82, n + axisMask * 0.3);

        float shellFade = 1.0 - uLayerRatio * 0.68;
        float visibilityBoost = mix(0.85, 1.15, uIsLow);

        float alpha =
          0.045 * uStrength * shellFade +
          particleMask * axisMask * uStrength * 0.24 * shellFade * visibilityBoost;

        alpha *= mix(0.9, 0.34, uLayerRatio);

        if (alpha < 0.014) {
          discard;
        }

        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;

  return material;
}

function createAxisShell({
  mesh,
  objectCenterWorld,
  axis,
  level,
  direction,
}: {
  mesh: THREE.Mesh;
  objectCenterWorld: THREE.Vector3;
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
  direction: ConfidenceDirection;
}) {
  const layerCount = getLayerCount(level);

  if (layerCount === 0) {
    return null;
  }

  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    const material = makeAxisShellMaterial({
      objectCenterWorld,
      axis,
      level,
      direction,
      layerIndex,
      layerCount,
    });

    const shell = new THREE.Mesh(mesh.geometry.clone(), material);

    shell.renderOrder = 999 - layerIndex;
    shell.userData[FUZZY_VISUAL_CHILD] = true;

    group.add(shell);
  }

  return group;
}

function createFuzzyVolume({
  mesh,
  objectCenterWorld,
  confidence,
  directions,
}: {
  mesh: THREE.Mesh;
  objectCenterWorld: THREE.Vector3;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
}) {
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  const xShell = createAxisShell({
    mesh,
    objectCenterWorld,
    axis: "x",
    level: confidence.x,
    direction: directions.x,
  });

  const yShell = createAxisShell({
    mesh,
    objectCenterWorld,
    axis: "y",
    level: confidence.y,
    direction: directions.y,
  });

  const zShell = createAxisShell({
    mesh,
    objectCenterWorld,
    axis: "z",
    level: confidence.z,
    direction: directions.z,
  });

  if (xShell) {
    group.add(xShell);
  }

  if (yShell) {
    group.add(yShell);
  }

  if (zShell) {
    group.add(zShell);
  }

  if (group.children.length === 0) {
    return null;
  }

  return group;
}

function applyUncertaintyToMesh({
  mesh,
  objectCenterWorld,
  confidence,
  directions,
  strength,
}: {
  mesh: THREE.Mesh;
  objectCenterWorld: THREE.Vector3;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  strength: number;
}) {
  dimOriginalMesh(mesh, strength);

  const fuzzyVolume = createFuzzyVolume({
    mesh,
    objectCenterWorld,
    confidence,
    directions,
  });

  const dashedBoundary = createDashedBoundary(mesh, strength);

  if (fuzzyVolume) {
    mesh.add(fuzzyVolume);
  }

  mesh.add(dashedBoundary);
}

function applyUncertaintyToObject({
  object,
  confidence,
  directions,
}: {
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
}) {
  if (!hasUncertainty(confidence)) {
    return;
  }

  const strength = getMaxUncertainty(confidence);
  const meshes: THREE.Mesh[] = [];

  const objectBox = new THREE.Box3().setFromObject(object);
  const objectCenterWorld = new THREE.Vector3();

  objectBox.getCenter(objectCenterWorld);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    meshes.push(child);
  });

  for (const mesh of meshes) {
    applyUncertaintyToMesh({
      mesh,
      objectCenterWorld,
      confidence,
      directions,
      strength,
    });
  }
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
) {
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
    });
  }
}