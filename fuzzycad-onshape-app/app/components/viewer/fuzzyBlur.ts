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

function confidenceToStrength(level: ConfidenceLevel) {
  if (level === "low") {
    return 1.0;
  }

  if (level === "medium") {
    return 0.45;
  }

  return 0.0;
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

function getSourceMap(material: THREE.Material) {
  const materialWithMap = material as THREE.MeshStandardMaterial;

  return materialWithMap.map ?? null;
}

function getAxisStrength(confidence: AxisConfidenceMap) {
  return new THREE.Vector3(
    confidenceToStrength(confidence.x),
    confidenceToStrength(confidence.y),
    confidenceToStrength(confidence.z),
  );
}

function hasUncertainty(confidence: AxisConfidenceMap) {
  return (
    confidence.x !== "high" ||
    confidence.y !== "high" ||
    confidence.z !== "high"
  );
}

function makeFuzzyMaterial({
  sourceMaterial,
  confidence,
  box,
}: {
  sourceMaterial: THREE.Material;
  confidence: AxisConfidenceMap;
  box: THREE.Box3;
}) {
  const axisStrength = getAxisStrength(confidence);
  const maxStrength = Math.max(axisStrength.x, axisStrength.y, axisStrength.z);

  const material = new THREE.MeshStandardMaterial({
    color: getMaterialColor(sourceMaterial),
    map: getSourceMap(sourceMaterial),
    transparent: true,
    opacity: maxStrength >= 1 ? 0.92 : 0.97,
    alphaTest: 0.04,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    emissive: new THREE.Color(0x3b82f6),
    emissiveIntensity: maxStrength >= 1 ? 0.18 : 0.08,
  });

  const min = box.min.clone();
  const max = box.max.clone();

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFuzzyMin = { value: min };
    shader.uniforms.uFuzzyMax = { value: max };
    shader.uniforms.uFuzzyStrength = { value: axisStrength };

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `
#include <common>
varying vec3 vFuzzyWorldPosition;
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
#include <begin_vertex>
vec4 fuzzyWorldPosition = modelMatrix * vec4(transformed, 1.0);
vFuzzyWorldPosition = fuzzyWorldPosition.xyz;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `
#include <common>
varying vec3 vFuzzyWorldPosition;
uniform vec3 uFuzzyMin;
uniform vec3 uFuzzyMax;
uniform vec3 uFuzzyStrength;

float fuzzyHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float fuzzyNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = fuzzyHash(i + vec3(0.0, 0.0, 0.0));
  float n100 = fuzzyHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = fuzzyHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = fuzzyHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = fuzzyHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = fuzzyHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = fuzzyHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = fuzzyHash(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);

  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);

  return mix(nxy0, nxy1, f.z);
}
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      `
#include <alphatest_fragment>

vec3 fuzzySpan = max(uFuzzyMax - uFuzzyMin, vec3(0.0001));
vec3 fuzzyT = clamp((vFuzzyWorldPosition - uFuzzyMin) / fuzzySpan, 0.0, 1.0);

// Stronger fuzz near the uncertain axis boundaries.
vec3 distanceToAxisBoundary = min(fuzzyT, 1.0 - fuzzyT);
vec3 axisBoundaryMask =
  1.0 - smoothstep(vec3(0.0), vec3(0.24), distanceToAxisBoundary);

float axisFuzz = max(
  max(axisBoundaryMask.x * uFuzzyStrength.x, axisBoundaryMask.y * uFuzzyStrength.y),
  axisBoundaryMask.z * uFuzzyStrength.z
);

// Also add a weaker all-over material instability, so it reads as uncertainty,
// not only as transparent ends.
float fullBodyInstability = max(
  max(uFuzzyStrength.x, uFuzzyStrength.y),
  uFuzzyStrength.z
) * 0.22;

float noiseA = fuzzyNoise(vFuzzyWorldPosition * 28.0);
float noiseB = fuzzyNoise(vFuzzyWorldPosition * 73.0 + vec3(4.7, 2.1, 8.3));

float noisyMask = mix(noiseA, noiseB, 0.45);
float fuzzyAmount = clamp(axisFuzz + fullBodyInstability, 0.0, 1.0);

// This creates a visible dissolve / particulate fuzzy material.
float dissolve = smoothstep(0.18, 0.92, noisyMask + fuzzyAmount * 0.32);
float alphaMultiplier = mix(1.0, dissolve, fuzzyAmount);

diffuseColor.a *= alphaMultiplier;

if (fuzzyAmount > 0.05 && diffuseColor.a < 0.16) {
  discard;
}
      `,
    );
  };

  material.customProgramCacheKey = () =>
    `fuzzy-material-${axisStrength.x}-${axisStrength.y}-${axisStrength.z}`;

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;
  material.needsUpdate = true;

  return material;
}

function getMeshMaterials(mesh: THREE.Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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

    objects.push(object);
  });

  return objects;
}

function applyFuzzyMaterialToObject({
  object,
  confidence,
}: {
  object: THREE.Object3D;
  confidence: AxisConfidenceMap;
}) {
  if (!hasUncertainty(confidence)) {
    return;
  }

  const box = new THREE.Box3().setFromObject(object);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const currentMaterials = getMeshMaterials(child);

    if (!child.userData[FUZZY_ORIGINAL_MATERIALS]) {
      child.userData[FUZZY_ORIGINAL_MATERIALS] = currentMaterials;
    }

    const fuzzyMaterials = currentMaterials.map((material) =>
      makeFuzzyMaterial({
        sourceMaterial: material,
        confidence,
        box,
      }),
    );

    child.material =
      Array.isArray(child.material) ? fuzzyMaterials : fuzzyMaterials[0];
  });
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
) {
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

    applyFuzzyMaterialToObject({
      object,
      confidence: annotation.confidence,
    });
  }
}