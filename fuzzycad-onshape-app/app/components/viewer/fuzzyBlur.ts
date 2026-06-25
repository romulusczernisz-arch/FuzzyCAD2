import * as THREE from "three";
import type {
  AxisConfidenceMap,
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
    return 0.35;
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

    // 原 object 只作为很淡的 reference geometry。
    // 如果你想只保留 dash line，可以继续把这两个值调低。
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

    // 只收集最外层 visual group，避免重复 dispose child。
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

    // 比之前更松：不要让 dash line 看起来像密集 mesh edge。
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

function makeFuzzyVolumeMaterial({
  confidence,
  layerIndex,
  layerCount,
}: {
  confidence: AxisConfidenceMap;
  layerIndex: number;
  layerCount: number;
}) {
  const axisStrength = getAxisStrength(confidence);
  const maxStrength = getMaxUncertainty(confidence);
  const layerRatio = layerIndex / Math.max(layerCount - 1, 1);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uAxisStrength: {
        value: axisStrength,
      },
      uMaxStrength: {
        value: maxStrength,
      },
      uLayerRatio: {
        value: layerRatio,
      },
      uColor: {
        value: new THREE.Color(0x2b6cff),
      },
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      varying float vAxisFuzz;

      uniform vec3 uAxisStrength;
      uniform float uMaxStrength;
      uniform float uLayerRatio;

      void main() {
        vLocalPosition = position;

        vec3 transformedPosition = position;

        vec3 directionFromCenter = normalize(position + vec3(0.0001));

        // 新逻辑：
        // 内层几乎贴着 object；外层才扩出去。
        // 越不确定，扩得越宽。
        float shellExpansion = mix(0.006, 0.085, uLayerRatio) * uMaxStrength;

        transformedPosition += directionFromCenter * shellExpansion;

        // 轴向扩张：high = 0，所以 high confidence 方向不会被染色/扩张。
        transformedPosition.x += sign(position.x) * uAxisStrength.x * mix(0.002, 0.026, uLayerRatio);
        transformedPosition.y += sign(position.y) * uAxisStrength.y * mix(0.006, 0.065, uLayerRatio);
        transformedPosition.z += sign(position.z) * uAxisStrength.z * mix(0.002, 0.026, uLayerRatio);

        vec3 p = normalize(abs(position) + vec3(0.0001));

        float xFuzz = p.x * uAxisStrength.x;
        float yFuzz = p.y * uAxisStrength.y;
        float zFuzz = p.z * uAxisStrength.z;

        vAxisFuzz = max(max(xFuzz, yFuzz), zFuzz);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vLocalPosition;
      varying float vAxisFuzz;

      uniform float uMaxStrength;
      uniform float uLayerRatio;
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
        float n1 = noise(vLocalPosition * 16.0);
        float n2 = noise(vLocalPosition * 43.0 + vec3(3.7, 8.1, 2.4));
        float n = mix(n1, n2, 0.45);

        // vAxisFuzz 越大，说明这个 fragment 越接近不确定轴向的显著区域。
        float uncertaintyMask = clamp(vAxisFuzz, 0.0, 1.0);

        // High confidence 区域不给颜色；uncertainty 低于阈值直接不显示。
        if (uncertaintyMask < 0.05) {
          discard;
        }

        // 外层更淡，内层更贴合 object。
        float shellFade = 1.0 - uLayerRatio * 0.78;

        // 蓝色 shell 里加入一点 noise，让它不是普通半透明塑料。
        float particleMask = smoothstep(0.18, 0.82, n + uncertaintyMask * 0.35);

        float alpha =
          0.035 * uMaxStrength * shellFade +
          particleMask * uncertaintyMask * 0.24 * shellFade;

        // 越外层越透明，形成 blue -> transparent 的范围感。
        alpha *= mix(0.9, 0.28, uLayerRatio);

        if (alpha < 0.015) {
          discard;
        }

        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;

  return material;
}

function createFuzzyVolume(mesh: THREE.Mesh, confidence: AxisConfidenceMap) {
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;

  // 只做 3 层，比之前 4 层更克制，避免底下拖出太多层。
  const layerCount = 3;

  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    const material = makeFuzzyVolumeMaterial({
      confidence,
      layerIndex,
      layerCount,
    });

    // Clone geometry to avoid disposing the original CAD mesh geometry.
    const volume = new THREE.Mesh(mesh.geometry.clone(), material);

    volume.renderOrder = 999 - layerIndex;
    volume.userData[FUZZY_VISUAL_CHILD] = true;

    group.add(volume);
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

  mesh.add(fuzzyVolume);
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