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

const LINE_OVERLAY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;

  void main() {
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

  varying vec3 vWorldNormal;

  float random(vec2 value) {
    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec2 direction = normalize(vec2(cos(uAngle), sin(uAngle)));

    float projected = dot(gl_FragCoord.xy, direction);
    float stripe = fract(projected / uSpacing);

    float distanceToLine = abs(stripe - 0.5);

    float line = 1.0 - smoothstep(
      uThickness,
      uThickness + 0.055,
      distanceToLine
    );

    float paperNoise = random(floor(gl_FragCoord.xy / 4.0));
    float brokenLine = mix(0.78, 1.0, paperNoise);

    vec3 normal = normalize(vWorldNormal);
    vec3 lightDirection = normalize(vec3(0.25, 0.7, 0.45));
    float facing = dot(normal, lightDirection) * 0.5 + 0.5;

    float shadeWeight = mix(0.7, 1.0, 1.0 - facing);

    float alpha = line * brokenLine * shadeWeight * uOpacity;

    if (alpha < 0.015) {
      discard;
    }

    gl_FragColor = vec4(uLineColor, alpha);
  }
`;

function createLineOverlayMaterial() {
  const material = new THREE.ShaderMaterial({
    vertexShader: LINE_OVERLAY_VERTEX_SHADER,
    fragmentShader: LINE_OVERLAY_FRAGMENT_SHADER,
    uniforms: {
      uLineColor: { value: new THREE.Color(0x111827) },
      uOpacity: { value: 0.82 },
      uSpacing: { value: 9.0 },
      uThickness: { value: 0.075 },
      uAngle: { value: Math.PI * 0.18 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
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

    const overlayGeometry = sourceGeometry.clone();
    const overlayMaterial = createLineOverlayMaterial();

    const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);

    overlayMesh.matrixAutoUpdate = false;
    overlayMesh.matrix.copy(objectWorldInverse.clone().multiply(child.matrixWorld));
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

  if (annotations.length === 0) {
    return;
  }

  const targetObjects = findTopLevelObjectsByPathKeys(
    scene,
    annotations.map((annotation) => annotation.pathKey),
  );

  for (const object of targetObjects) {
    const overlay = createSelectedObjectLineOverlay(object);

    if (!overlay) {
      continue;
    }

    object.add(overlay);
  }
}