import * as THREE from "three";
import type {
  ConfidenceAxis,
  FuzzyConfidenceAnnotation,
} from "../../lib/uncertainty/types";

export type { FuzzyConfidenceAnnotation };

export type ConfidenceAxisFrame = Record<
  ConfidenceAxis,
  [number, number, number]
>;

const FUZZY_VISUAL_CHILD = "__fuzzycad_uncertainty_visual_child__";
const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";



const LINE_OVERLAY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_OVERLAY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uLineColor;
  uniform float uOpacity;
  uniform float uSpacing;
  uniform float uThickness;
  uniform float uAngle;

  uniform float uRimStrength;
  uniform float uRimPower;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  float random(vec2 value) {
    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // line direction
    vec2 direction = normalize(vec2(cos(uAngle), sin(uAngle)));
    float projected = dot(gl_FragCoord.xy, direction);
    float stripe = fract(projected / uSpacing);
    float distanceToLine = abs(stripe - 0.5);

    float line = 1.0 - smoothstep(
      uThickness,
      uThickness + 0.055,
      distanceToLine
    );

    // slight hand-drawn breakup
    float paperNoise = random(floor(gl_FragCoord.xy / 4.0));
    float brokenLine = mix(0.78, 1.0, paperNoise);

    // simple shading term
    vec3 lightDirection = normalize(vec3(0.25, 0.7, 0.45));
    float facing = dot(normal, lightDirection) * 0.5 + 0.5;
    float shadeWeight = mix(0.78, 1.0, 1.0 - facing);

    // rim term: stronger near silhouette
    float rim = pow(1.0 - abs(dot(normal, viewDir)), uRimPower);

    // 不要做 glow，只拿 rim 来增强线条可见性
    float rimBoost = 1.0 + rim * uRimStrength;

    float alpha = line * brokenLine * shadeWeight * rimBoost * uOpacity;

    if (alpha < 0.015) {
      discard;
    }

    gl_FragColor = vec4(uLineColor, alpha);
  }
`;

const OUTER_OUTLINE_VERTEX_SHADER = /* glsl */ `
  uniform float uOutlineWidth;

  void main() {
    vec3 expandedPosition = position + normal * uOutlineWidth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(expandedPosition, 1.0);
  }
`;

const OUTER_OUTLINE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uOutlineColor;
  uniform float uOutlineOpacity;

  void main() {
    gl_FragColor = vec4(uOutlineColor, uOutlineOpacity);
  }
`;

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

function hideOriginalMaterials(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    if (!child.userData[FUZZY_ORIGINAL_MATERIALS]) {
      child.userData[FUZZY_ORIGINAL_MATERIALS] = getMeshMaterials(child);
    }

    const originalMaterials = child.userData[
      FUZZY_ORIGINAL_MATERIALS
    ] as THREE.Material[];

    const hiddenMaterials = originalMaterials.map((material) => {
      const hidden = material.clone();

      // 关键：不要 transparent true。
      // 它要作为 invisible depth mask 先写入 depth buffer。
      hidden.transparent = false;
      hidden.opacity = 1.0;

      // 不写颜色，所以看不见原 mesh。
      hidden.colorWrite = false;

      // 关键：必须写 depth，不然 outline shell 会整片露出来。
      hidden.depthWrite = true;
      hidden.depthTest = true;

      hidden.userData[FUZZY_ACTIVE_MATERIAL] = true;

      return hidden;
    });

    child.material =
      hiddenMaterials.length === 1 ? hiddenMaterials[0] : hiddenMaterials;

    // 让 invisible depth mask 先画。
    child.renderOrder = 1400;
  });
}

function createLineOverlayMaterial() {
  const material = new THREE.ShaderMaterial({
    vertexShader: LINE_OVERLAY_VERTEX_SHADER,
    fragmentShader: LINE_OVERLAY_FRAGMENT_SHADER,
    uniforms: {
      uLineColor: { value: new THREE.Color(0x111827) },
      uOpacity: { value: 0.78 },
      uSpacing: { value: 8.0 },
      uThickness: { value: 0.075 },
      uAngle: { value: Math.PI * 0.18 },

      uRimStrength: { value: 0.55 },
      uRimPower: { value: 2.2 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  material.userData[FUZZY_VISUAL_CHILD] = true;

  return material;
}

function getGeometryOutlineWidth(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingSphere();

  const radius = geometry.boundingSphere?.radius ?? 1;

  return Math.max(radius * 0.0045, 0.0005);
}

function createOuterOutlineMaterial(outlineWidth: number) {
  const material = new THREE.ShaderMaterial({
    vertexShader: OUTER_OUTLINE_VERTEX_SHADER,
    fragmentShader: OUTER_OUTLINE_FRAGMENT_SHADER,
    uniforms: {
      uOutlineWidth: { value: outlineWidth },
      uOutlineColor: { value: new THREE.Color(0x111827) },
      uOutlineOpacity: { value: 0.9 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  material.userData[FUZZY_VISUAL_CHILD] = true;

  return material;
}

function disposeObjectVisual(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) {
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

function createSelectedObjectLineOverlay(object: THREE.Object3D) {
  const overlayGroup = new THREE.Group();

  overlayGroup.userData[FUZZY_VISUAL_CHILD] = true;
  overlayGroup.renderOrder = 1600;

  object.updateWorldMatrix(true, true);

  const objectWorldInverse = object.matrixWorld.clone().invert();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const sourceGeometry = child.geometry;

    if (!sourceGeometry) {
      return;
    }

    child.updateWorldMatrix(true, false);

    const childToObjectMatrix = objectWorldInverse
      .clone()
      .multiply(child.matrixWorld);

    // 1) 外边框 outline shell
    const outlineGeometry = sourceGeometry.clone();
    const outlineWidth = getGeometryOutlineWidth(outlineGeometry);
    const outlineMaterial = createOuterOutlineMaterial(outlineWidth);

    const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);

    outlineMesh.matrixAutoUpdate = false;
    outlineMesh.matrix.copy(childToObjectMatrix);
    outlineMesh.renderOrder = 1550;
    outlineMesh.frustumCulled = false;
    outlineMesh.userData[FUZZY_VISUAL_CHILD] = true;

    overlayGroup.add(outlineMesh);

    // 2) 内部 line overlay
    const overlayGeometry = sourceGeometry.clone();
    const overlayMaterial = createLineOverlayMaterial();

    const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);

    overlayMesh.matrixAutoUpdate = false;
    overlayMesh.matrix.copy(childToObjectMatrix);
    overlayMesh.renderOrder = 1600;
    overlayMesh.frustumCulled = false;
    overlayMesh.userData[FUZZY_VISUAL_CHILD] = true;

    overlayGroup.add(overlayMesh);
  });

  if (overlayGroup.children.length === 0) {
    return null;
  }

  return overlayGroup;
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
  _axisFramesByPathKey?: Map<string, ConfidenceAxisFrame>,
) {
  scene.updateMatrixWorld(true);

  clearFuzzyVisualChildren(scene);
  restoreOriginalMaterials(scene);

  if (annotations.length === 0) {
    return;
  }

  const targetObjects = findTopLevelObjectsByPathKeys(
    scene,
    annotations.map((annotation) => annotation.pathKey),
  );

  for (const object of targetObjects) {
    hideOriginalMaterials(object);

    const overlay = createSelectedObjectLineOverlay(object);

    if (!overlay) {
      continue;
    }

    object.add(overlay);
  }
}