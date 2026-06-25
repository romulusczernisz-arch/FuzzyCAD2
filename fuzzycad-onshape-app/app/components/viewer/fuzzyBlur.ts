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
    return 0.45;
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

    // 原 object 还在，但非常弱。你如果想完全隐藏，可以把这里改成 0.02。
    opacity: strength >= 1 ? 0.08 : 0.16,

    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;

  return material;
}

function clearFuzzyVisualChildren(scene: THREE.Object3D) {
  const childrenToRemove: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (object.userData?.[FUZZY_VISUAL_CHILD]) {
      childrenToRemove.push(object);
    }
  });

  for (const child of childrenToRemove) {
    child.parent?.remove(child);

    if (child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
      child.geometry.dispose();

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      for (const material of materials) {
        material.dispose();
      }
    }
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

  mesh.material = Array.isArray(mesh.material) ? dimmedMaterials : dimmedMaterials[0];
}

function createDashedBoundary(mesh: THREE.Mesh, strength: number) {
  const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 18);

  const material = new THREE.LineDashedMaterial({
    // 你说不一定要蓝色，所以这里改成黑色。
    color: 0x111111,

    // WebGL 里 linewidth 很多浏览器不会真正变粗，所以主要靠 opacity/dash/gap。
    linewidth: 1,

    // “松一点”的 dashed line：dash 和 gap 都比之前大。
    dashSize: strength >= 1 ? 0.055 : 0.075,
    gapSize: strength >= 1 ? 0.038 : 0.052,

    transparent: true,
    opacity: strength >= 1 ? 0.95 : 0.65,

    // 让 dashed boundary 永远更容易看见。
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.LineSegments(edgeGeometry, material);

  line.computeLineDistances();
  line.renderOrder = 1000;
  line.userData[FUZZY_VISUAL_CHILD] = true;

  // 关键：直接作为 mesh 的 child。
  // 这样它使用 mesh 的 local geometry，不需要 matrixWorld，所以不会偏位。
  return line;
}

function makeFuzzyVolumeMaterial(confidence: AxisConfidenceMap) {
  const axisStrength = getAxisStrength(confidence);
  const maxStrength = getMaxUncertainty(confidence);

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

      uniform vec3 uAxisStrength;

      void main() {
        vLocalPosition = position;

        vec3 transformedPosition = position;

        // 这一步不是生成 bounding box，而是让 object 自己的 geometry
        // 在不确定轴向上略微膨胀，所以会形成贴着原模型的 fuzzy volume。
        vec3 directionFromCenter = normalize(position + vec3(0.0001));

        transformedPosition += directionFromCenter * (
          0.035 +
          uMaxStrength * 0.045
        );

        // 轴向不确定越强，对该方向的扰动越明显。
        transformedPosition.x += sign(position.x) * uAxisStrength.x * 0.018;
        transformedPosition.y += sign(position.y) * uAxisStrength.y * 0.055;
        transformedPosition.z += sign(position.z) * uAxisStrength.z * 0.018;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPosition, 1.0);
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
        vec3 p = normalize(abs(vLocalPosition) + vec3(0.0001));

        float xFuzz = p.x * uAxisStrength.x;
        float yFuzz = p.y * uAxisStrength.y;
        float zFuzz = p.z * uAxisStrength.z;

        float axisFuzz = max(max(xFuzz, yFuzz), zFuzz);

        float n1 = noise(vLocalPosition * 18.0);
        float n2 = noise(vLocalPosition * 47.0 + vec3(3.7, 8.1, 2.4));
        float n = mix(n1, n2, 0.45);

        float particle = smoothstep(0.18, 0.88, n + axisFuzz * 0.42);

        // low confidence 会更明显；medium 会轻一些。
        float alpha = 0.035 * uMaxStrength + particle * axisFuzz * 0.22;

        if (alpha < 0.018) {
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
  // 关键：这里用 mesh.geometry，不用 bounding box。
  // 所以 fuzzy volume 是沿着真实 object geometry 的。
  const material = makeFuzzyVolumeMaterial(confidence);
  const volume = new THREE.Mesh(mesh.geometry, material);

  volume.renderOrder = 999;
  volume.userData[FUZZY_VISUAL_CHILD] = true;

  return volume;
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

  // 关键：这两个 visual 都直接挂在原 mesh 下面。
  // 这样 dashed line 和 fuzzy volume 一定和原 mesh 重合。
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