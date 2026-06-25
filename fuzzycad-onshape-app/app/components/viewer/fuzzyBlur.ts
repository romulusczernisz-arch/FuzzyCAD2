import * as THREE from "three";
import type {
  AxisConfidenceMap,
  ConfidenceLevel,
  FuzzyConfidenceAnnotation,
} from "../../lib/uncertainty/types";

export type { FuzzyConfidenceAnnotation };

const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";
const FUZZY_VISUAL_GROUP = "__fuzzycad_uncertainty_visual_group__";

function confidenceToStrength(level: ConfidenceLevel) {
  if (level === "low") {
    return 1.0;
  }

  if (level === "medium") {
    return 0.48;
  }

  return 0.0;
}

function getAxisStrength(confidence: AxisConfidenceMap) {
  return new THREE.Vector3(
    confidenceToStrength(confidence.x),
    confidenceToStrength(confidence.y),
    confidenceToStrength(confidence.z),
  );
}

function getMaxUncertainty(confidence: AxisConfidenceMap) {
  const axisStrength = getAxisStrength(confidence);

  return Math.max(axisStrength.x, axisStrength.y, axisStrength.z);
}

function hasUncertainty(confidence: AxisConfidenceMap) {
  return getMaxUncertainty(confidence) > 0;
}

function getMeshMaterials(mesh: THREE.Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function getMaterialColor(material: THREE.Material) {
  const materialWithColor = material as THREE.MeshStandardMaterial;

  if (materialWithColor.color) {
    return materialWithColor.color.clone();
  }

  return new THREE.Color(0x6aa8ff);
}

function makeDimmedMaterial(sourceMaterial: THREE.Material, strength: number) {
  const materialWithMap = sourceMaterial as THREE.MeshStandardMaterial;

  const material = new THREE.MeshStandardMaterial({
    color: getMaterialColor(sourceMaterial),
    map: materialWithMap.map ?? null,
    transparent: true,
    opacity: strength >= 1 ? 0.28 : 0.46,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    emissive: new THREE.Color(0x3b82f6),
    emissiveIntensity: strength >= 1 ? 0.18 : 0.08,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;

  return material;
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

function clearFuzzyVisualGroups(scene: THREE.Object3D) {
  const groups: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (object.name === FUZZY_VISUAL_GROUP) {
      groups.push(object);
    }
  });

  for (const group of groups) {
    group.traverse((child) => {
      if (child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        child.geometry.dispose();

        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        for (const material of materials) {
          material.dispose();
        }
      }
    });

    group.parent?.remove(group);
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

    objects.push(object);
  });

  return objects;
}

function dimObjectMaterial(object: THREE.Object3D, strength: number) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const currentMaterials = getMeshMaterials(child);

    if (!child.userData[FUZZY_ORIGINAL_MATERIALS]) {
      child.userData[FUZZY_ORIGINAL_MATERIALS] = currentMaterials;
    }

    const fuzzyMaterials = currentMaterials.map((material) =>
      makeDimmedMaterial(material, strength),
    );

    child.material =
      Array.isArray(child.material) ? fuzzyMaterials : fuzzyMaterials[0];
  });
}

function createDashedBoundaryForMesh({
  mesh,
  strength,
}: {
  mesh: THREE.Mesh;
  strength: number;
}) {
  const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 22);

  const material = new THREE.LineDashedMaterial({
    color: strength >= 1 ? 0x005dff : 0x4f8cff,
    linewidth: 2,
    dashSize: strength >= 1 ? 0.016 : 0.03,
    gapSize: strength >= 1 ? 0.012 : 0.026,
    transparent: true,
    opacity: strength >= 1 ? 1.0 : 0.72,
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(edgeGeometry, material);

  line.computeLineDistances();
  line.renderOrder = 999;
  line.matrixAutoUpdate = false;
  line.matrix.copy(mesh.matrixWorld);
  line.userData.fuzzyBoundary = true;

  return line;
}

function createDashedBoundaryGroup(object: THREE.Object3D, strength: number) {
  const group = new THREE.Group();

  group.name = FUZZY_VISUAL_GROUP;
  group.userData.fuzzyBoundary = true;

  object.updateMatrixWorld(true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    group.add(
      createDashedBoundaryForMesh({
        mesh: child,
        strength,
      }),
    );
  });

  return group;
}

function makeVolumeBlurMaterial(confidence: AxisConfidenceMap) {
  const axisStrength = getAxisStrength(confidence);
  const maxStrength = Math.max(axisStrength.x, axisStrength.y, axisStrength.z);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      uAxisStrength: {
        value: axisStrength,
      },
      uMaxStrength: {
        value: maxStrength,
      },
      uColor: {
        value: new THREE.Color(0x2b6cff),
      },
    },
    vertexShader: `
      varying vec3 vLocalPosition;

      void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vLocalPosition;

      uniform vec3 uAxisStrength;
      uniform float uMaxStrength;
      uniform vec3 uColor;

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
        // Box geometry is normalized around local center.
        // Values near +/- side faces should become more visible for uncertain axes.
        vec3 normalizedPosition = abs(vLocalPosition);

        float xFace = smoothstep(0.22, 0.5, normalizedPosition.x) * uAxisStrength.x;
        float yFace = smoothstep(0.22, 0.5, normalizedPosition.y) * uAxisStrength.y;
        float zFace = smoothstep(0.22, 0.5, normalizedPosition.z) * uAxisStrength.z;

        float faceUncertainty = max(max(xFace, yFace), zFace);

        float n1 = noise(vLocalPosition * 9.0);
        float n2 = noise(vLocalPosition * 23.0 + vec3(4.1, 2.7, 8.3));
        float fuzzyNoise = mix(n1, n2, 0.45);

        float particleMask = smoothstep(0.26, 0.94, fuzzyNoise + faceUncertainty * 0.42);

        float alpha =
          0.035 * uMaxStrength +
          faceUncertainty * 0.28 * particleMask;

        if (alpha < 0.018) {
          discard;
        }

        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  return material;
}

function createVolumeBlurBox({
  object,
  confidence,
}: {
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
}) {
  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  box.getCenter(center);
  box.getSize(size);

  const axisStrength = getAxisStrength(confidence);

  // Expand only along uncertain axes.
  // High confidence axis does not expand.
  const expandedSize = new THREE.Vector3(
    size.x * (1 + axisStrength.x * 0.55),
    size.y * (1 + axisStrength.y * 0.55),
    size.z * (1 + axisStrength.z * 0.55),
  );

  expandedSize.x = Math.max(expandedSize.x, 0.01);
  expandedSize.y = Math.max(expandedSize.y, 0.01);
  expandedSize.z = Math.max(expandedSize.z, 0.01);

  const geometry = new THREE.BoxGeometry(
    expandedSize.x,
    expandedSize.y,
    expandedSize.z,
  );

  // Normalize local coordinates to roughly -0.5 to 0.5 in shader.
  geometry.computeBoundingBox();

  const material = makeVolumeBlurMaterial(confidence);

  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(center);
  mesh.renderOrder = 998;
  mesh.userData.fuzzyVolume = true;

  return mesh;
}

function applyUncertaintyVisualToObject({
  scene,
  object,
  confidence,
}: {
  scene: THREE.Object3D;
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
}) {
  if (!hasUncertainty(confidence)) {
    return;
  }

  const strength = getMaxUncertainty(confidence);

  dimObjectMaterial(object, strength);

  const boundaryGroup = createDashedBoundaryGroup(object, strength);
  const volumeBlur = createVolumeBlurBox({
    object,
    confidence,
  });

  const visualGroup = new THREE.Group();

  visualGroup.name = FUZZY_VISUAL_GROUP;
  visualGroup.userData.fuzzyUncertaintyVisual = true;

  visualGroup.add(volumeBlur);
  visualGroup.add(boundaryGroup);

  scene.add(visualGroup);
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
) {
  restoreOriginalMaterials(scene);
  clearFuzzyVisualGroups(scene);

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

    applyUncertaintyVisualToObject({
      scene,
      object,
      confidence: annotation.confidence,
    });
  }
}