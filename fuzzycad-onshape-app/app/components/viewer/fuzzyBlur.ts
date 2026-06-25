import * as THREE from "three";
import type {
  AxisConfidenceMap,
  ConfidenceAxis,
  ConfidenceLevel,
  FuzzyConfidenceAnnotation,
} from "../../lib/uncertainty/types";

export type { FuzzyConfidenceAnnotation };

const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";
const FUZZY_VISUAL_CHILD = "__fuzzycad_uncertainty_visual_child__";

function confidenceToStrength(level: ConfidenceLevel) {
  if (level === "low") {
    return 1.0;
  }

  if (level === "medium") {
    return 0.42;
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

function getAxisMask(axis: ConfidenceAxis) {
  if (axis === "x") {
    return new THREE.Vector3(1, 0, 0);
  }

  if (axis === "y") {
    return new THREE.Vector3(0, 1, 0);
  }

  return new THREE.Vector3(0, 0, 1);
}

function getShellColor(level: ConfidenceLevel) {
  if (level === "low") {
    // Stronger blue for low confidence.
    return new THREE.Color(0x1f5cff);
  }

  // Lighter blue for medium confidence.
  return new THREE.Color(0x8fc7ff);
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

    // Original CAD geometry becomes a weak reference layer.
    // Lower these values if you want only dashed line + shells.
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

    // Only remove top-level visual nodes. Nested visual children are disposed
    // together with their parent group.
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

    // Loose dashed boundary. This remains the reference geometry.
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
  axis,
  level,
  layerIndex,
  layerCount,
}: {
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
  layerIndex: number;
  layerCount: number;
}) {
  const strength = confidenceToStrength(level);
  const axisMask = getAxisMask(axis);
  const color = getShellColor(level);
  const layerRatio = layerIndex / Math.max(layerCount - 1, 1);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uAxisMask: {
        value: axisMask,
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
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      varying float vAxisPresence;

      uniform vec3 uAxisMask;
      uniform float uStrength;
      uniform float uLayerRatio;
      uniform float uIsLow;

      void main() {
        vLocalPosition = position;

        vec3 transformedPosition = position;

        vec3 safePosition = position + vec3(0.0001);
        vec3 directionFromCenter = normalize(safePosition);

        // Medium = narrow shell. Low = wider shell.
        float baseExpansion = mix(0.004, 0.018, uLayerRatio) * uStrength;
        float axisExpansion = mix(0.018, 0.13, uLayerRatio) * uStrength;

        // Low confidence gets a larger unresolved range.
        axisExpansion *= mix(0.75, 1.25, uIsLow);

        // A very small normal expansion keeps the shell outside the original object.
        transformedPosition += directionFromCenter * baseExpansion;

        // Main axis-specific expansion.
        transformedPosition += sign(position) * uAxisMask * axisExpansion;

        vec3 normalizedPosition = normalize(abs(position) + vec3(0.0001));

        // How much this vertex belongs to the selected axis direction.
        vAxisPresence = dot(normalizedPosition, uAxisMask);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vLocalPosition;
      varying float vAxisPresence;

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
        // Only show the shell where the selected axis is visually relevant.
        // This avoids turning the whole object into one uniform blue layer.
        float axisMask = smoothstep(0.22, 0.85, vAxisPresence);

        if (axisMask < 0.025) {
          discard;
        }

        float n1 = noise(vLocalPosition * 15.0);
        float n2 = noise(vLocalPosition * 41.0 + vec3(3.7, 8.1, 2.4));
        float n = mix(n1, n2, 0.45);

        float shellFade = 1.0 - uLayerRatio * 0.72;

        // Low confidence is more visible and more spatially diffuse.
        float visibilityBoost = mix(0.7, 1.15, uIsLow);

        float particleMask = smoothstep(0.16, 0.84, n + axisMask * 0.32);

        float alpha =
          0.035 * uStrength * shellFade +
          particleMask * axisMask * uStrength * 0.22 * shellFade * visibilityBoost;

        // Outer layers are softer and more transparent.
        alpha *= mix(0.82, 0.28, uLayerRatio);

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
  axis,
  level,
}: {
  mesh: THREE.Mesh;
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
}) {
  const layerCount = getLayerCount(level);

  if (layerCount === 0) {
    return null;
  }

  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    const material = makeAxisShellMaterial({
      axis,
      level,
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

function createFuzzyVolume(mesh: THREE.Mesh, confidence: AxisConfidenceMap) {
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  const xShell = createAxisShell({
    mesh,
    axis: "x",
    level: confidence.x,
  });

  const yShell = createAxisShell({
    mesh,
    axis: "y",
    level: confidence.y,
  });

  const zShell = createAxisShell({
    mesh,
    axis: "z",
    level: confidence.z,
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
  confidence,
  strength,
}: {
  mesh: THREE.Mesh;
  confidence: AxisConfidenceMap;
  strength: number;
}) {
  dimOriginalMesh(mesh, strength);

  const fuzzyVolume = createFuzzyVolume(mesh, confidence);
  const dashedBoundary = createDashedBoundary(mesh, strength);

  if (fuzzyVolume) {
    mesh.add(fuzzyVolume);
  }

  mesh.add(dashedBoundary);
}

function applyUncertaintyToObject({
  object,
  confidence,
}: {
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
}) {
  if (!hasUncertainty(confidence)) {
    return;
  }

  const strength = getMaxUncertainty(confidence);
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

  for (const mesh of meshes) {
    applyUncertaintyToMesh({
      mesh,
      confidence,
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
    });
  }
}