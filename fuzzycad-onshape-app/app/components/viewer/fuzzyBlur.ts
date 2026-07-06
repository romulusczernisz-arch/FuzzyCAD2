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

const FUZZY_VISUAL_CHILD = "__fuzzycad_uncertainty_visual_child__";
const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";
const FUZZY_ORIGINAL_RENDER_ORDER = "__fuzzycad_original_render_order__";

type DirectionalMeasure = {
  centerWorld: THREE.Vector3;
  axes: Record<ConfidenceAxis, THREE.Vector3>;
  halfExtents: Record<ConfidenceAxis, number>;
  objectSize: number;
};

type VisualProfile = {
  lineOpacity: number;
  lineSpacing: number;
  lineThickness: number;

  endLineOpacity: number;
  endLineSpacing: number;
  endLineThickness: number;
  endZoneStart: number;
  endZoneFeather: number;

  baseWeight: number;
  directionalWeight: number;

  rimStrength: number;
  rimPower: number;

  outlineOpacity: number;
  outlineWidthRatio: number;
};

type LineMaterialOverrides = {
  opacity?: number;
  spacing?: number;
  thickness?: number;

  endOpacity?: number;
  endSpacing?: number;
  endThickness?: number;

  angleOffset?: number;

  baseWeight?: number;
  directionalWeight?: number;

  rimStrength?: number;
  rimPower?: number;
};

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

  uniform float uEndOpacity;
  uniform float uEndSpacing;
  uniform float uEndThickness;
  uniform float uEndZoneStart;
  uniform float uEndZoneFeather;

  uniform float uAngle;

  uniform float uBaseWeight;
  uniform float uDirectionalWeight;

  uniform float uRimStrength;
  uniform float uRimPower;

  uniform vec3 uObjectCenter;

  uniform vec3 uAxisX;
  uniform vec3 uAxisY;
  uniform vec3 uAxisZ;

  uniform float uHalfExtentX;
  uniform float uHalfExtentY;
  uniform float uHalfExtentZ;

  uniform float uPositiveStrengthX;
  uniform float uNegativeStrengthX;
  uniform float uPositiveStrengthY;
  uniform float uNegativeStrengthY;
  uniform float uPositiveStrengthZ;
  uniform float uNegativeStrengthZ;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  float random(vec2 value) {
    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float stripeMask(float projected, float spacing, float thickness) {
    float stripe = fract(projected / spacing);
    float distanceToLine = abs(stripe - 0.5);

    return 1.0 - smoothstep(
      thickness,
      thickness + 0.055,
      distanceToLine
    );
  }

  float axisEndZoneMask(
    vec3 axis,
    float halfExtent,
    float positiveStrength,
    float negativeStrength
  ) {
    vec3 axisDir = normalize(axis);
    float coord = dot(vWorldPosition - uObjectCenter, axisDir);
    float normalizedCoord = coord / max(halfExtent, 0.0001);

    float positiveZone = smoothstep(
      uEndZoneStart - uEndZoneFeather,
      uEndZoneStart + uEndZoneFeather,
      normalizedCoord
    );

    float negativeZone = smoothstep(
      uEndZoneStart - uEndZoneFeather,
      uEndZoneStart + uEndZoneFeather,
      -normalizedCoord
    );

    float positiveContribution = positiveZone * positiveStrength;
    float negativeContribution = negativeZone * negativeStrength;

    return max(positiveContribution, negativeContribution);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    vec2 direction = normalize(vec2(cos(uAngle), sin(uAngle)));
    float projected = dot(gl_FragCoord.xy, direction);

    float baseLine = stripeMask(projected, uSpacing, uThickness);
    float endLine = stripeMask(projected, uEndSpacing, uEndThickness);

    float paperNoise = random(floor(gl_FragCoord.xy / 4.0));
    float brokenLine = mix(0.78, 1.0, paperNoise);

    vec3 lightDirection = normalize(vec3(0.25, 0.7, 0.45));
    float facing = dot(normal, lightDirection) * 0.5 + 0.5;
    float shadeWeight = mix(0.8, 1.0, 1.0 - facing);

    float endMaskX = axisEndZoneMask(
      uAxisX,
      uHalfExtentX,
      uPositiveStrengthX,
      uNegativeStrengthX
    );

    float endMaskY = axisEndZoneMask(
      uAxisY,
      uHalfExtentY,
      uPositiveStrengthY,
      uNegativeStrengthY
    );

    float endMaskZ = axisEndZoneMask(
      uAxisZ,
      uHalfExtentZ,
      uPositiveStrengthZ,
      uNegativeStrengthZ
    );

    float endMask = max(max(endMaskX, endMaskY), endMaskZ);

    float rim = pow(1.0 - abs(dot(normal, viewDir)), uRimPower);
    float baseRimBoost = 1.0 + rim * uRimStrength;
    float endRimBoost = 1.0 + rim * (uRimStrength + 0.25);

    float baseAlpha =
      baseLine *
      brokenLine *
      shadeWeight *
      uBaseWeight *
      baseRimBoost *
      uOpacity;

    float endAlpha =
      endLine *
      brokenLine *
      shadeWeight *
      endMask *
      uDirectionalWeight *
      endRimBoost *
      uEndOpacity;

    float alpha = baseAlpha + endAlpha;

    if (alpha < 0.015) {
      discard;
    }

    gl_FragColor = vec4(uLineColor, min(alpha, 1.0));
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

function confidenceToStrength(level: ConfidenceLevel) {
  if (level === "low") {
    return 1.0;
  }

  if (level === "medium") {
    return 0.48;
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

function getVisualProfile(confidence: AxisConfidenceMap): VisualProfile {
  const maxUncertainty = getMaxUncertainty(confidence);

  if (maxUncertainty >= 1.0) {
    return {
      lineOpacity: 0.16,
      lineSpacing: 13.0,
      lineThickness: 0.035,

      endLineOpacity: 0.92,
      endLineSpacing: 4.5,
      endLineThickness: 0.06,
      endZoneStart: 0.4,
      endZoneFeather: 0.16,

      baseWeight: 1.0,
      directionalWeight: 1.18,

      rimStrength: 0.22,
      rimPower: 2.0,

      outlineOpacity: 0.85,
      outlineWidthRatio: 0.0045,
    };
  }

  return {
    lineOpacity: 0.12,
    lineSpacing: 14.0,
    lineThickness: 0.03,

    endLineOpacity: 0.55,
    endLineSpacing: 6.2,
    endLineThickness: 0.05,
    endZoneStart: 0.42,
    endZoneFeather: 0.15,

    baseWeight: 1.0,
    directionalWeight: 0.88,

    rimStrength: 0.16,
    rimPower: 2.2,

    outlineOpacity: 0.6,
    outlineWidthRatio: 0.0036,
  };
}

function getGhostShellLayerCount(level: ConfidenceLevel) {
  if (level === "low") {
    return 2;
  }

  if (level === "medium") {
    return 1;
  }

  return 0;
}

function getDirectionSigns(direction: ConfidenceDirection): number[] {
  if (direction === "positive") {
    return [1];
  }

  if (direction === "negative") {
    return [-1];
  }

  return [-1, 1];
}



function normalizeAxisFrame(
  axisFrame: ConfidenceAxisFrame | undefined,
): Record<ConfidenceAxis, THREE.Vector3> {
  const frame = axisFrame ?? DEFAULT_AXIS_FRAME;

  return {
    x: new THREE.Vector3(...frame.x).normalize(),
    y: new THREE.Vector3(...frame.y).normalize(),
    z: new THREE.Vector3(...frame.z).normalize(),
  };
}

function getSideStrengths(
  level: ConfidenceLevel,
  direction: ConfidenceDirection,
) {
  const strength = confidenceToStrength(level);

  if (strength <= 0) {
    return {
      positive: 0,
      negative: 0,
    };
  }

  if (direction === "positive") {
    return {
      positive: strength,
      negative: 0,
    };
  }

  if (direction === "negative") {
    return {
      positive: 0,
      negative: strength,
    };
  }

  return {
    positive: strength,
    negative: strength,
  };
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

    const originalRenderOrder = object.userData[
      FUZZY_ORIGINAL_RENDER_ORDER
    ] as number | undefined;

    if (typeof originalRenderOrder === "number") {
      object.renderOrder = originalRenderOrder;
    }

    delete object.userData[FUZZY_ORIGINAL_MATERIALS];
    delete object.userData[FUZZY_ORIGINAL_RENDER_ORDER];
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

    if (typeof child.userData[FUZZY_ORIGINAL_RENDER_ORDER] !== "number") {
      child.userData[FUZZY_ORIGINAL_RENDER_ORDER] = child.renderOrder;
    }

    const originalMaterials = child.userData[
      FUZZY_ORIGINAL_MATERIALS
    ] as THREE.Material[];

    const hiddenMaterials = originalMaterials.map((material) => {
      const hidden = material.clone();

      hidden.transparent = false;
      hidden.opacity = 1.0;
      hidden.colorWrite = false;
      hidden.depthWrite = true;
      hidden.depthTest = true;

      hidden.userData[FUZZY_ACTIVE_MATERIAL] = true;

      return hidden;
    });

    child.material =
      hiddenMaterials.length === 1 ? hiddenMaterials[0] : hiddenMaterials;

    child.renderOrder = 1400;
  });
}

function collectObjectWorldPoints(object: THREE.Object3D) {
  const points: THREE.Vector3[] = [];
  const worldPoint = new THREE.Vector3();

  object.updateWorldMatrix(true, true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const position = child.geometry.getAttribute("position");

    if (!position) {
      return;
    }

    child.updateWorldMatrix(true, false);

    for (let index = 0; index < position.count; index += 1) {
      worldPoint
        .fromBufferAttribute(position, index)
        .applyMatrix4(child.matrixWorld);
      points.push(worldPoint.clone());
    }
  });

  if (points.length > 0) {
    return points;
  }

  const fallbackBox = new THREE.Box3().setFromObject(object);

  if (fallbackBox.isEmpty()) {
    return points;
  }

  return [
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.min.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.min.y, fallbackBox.max.z),
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.max.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.max.y, fallbackBox.max.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.min.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.min.y, fallbackBox.max.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.max.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.max.y, fallbackBox.max.z),
  ];
}

function measureObjectDirectionality(
  object: THREE.Object3D,
  axisFrame: ConfidenceAxisFrame | undefined,
): DirectionalMeasure | null {
  const points = collectObjectWorldPoints(object);

  if (points.length === 0) {
    return null;
  }

  const worldBox = new THREE.Box3().setFromPoints(points);
  const roughCenter = new THREE.Vector3();

  worldBox.getCenter(roughCenter);

  const axes = normalizeAxisFrame(axisFrame);

  const extents: Record<ConfidenceAxis, { min: number; max: number }> = {
    x: { min: Infinity, max: -Infinity },
    y: { min: Infinity, max: -Infinity },
    z: { min: Infinity, max: -Infinity },
  };

  for (const point of points) {
    const relative = point.clone().sub(roughCenter);

    (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
      const value = relative.dot(axes[axis]);

      extents[axis].min = Math.min(extents[axis].min, value);
      extents[axis].max = Math.max(extents[axis].max, value);
    });
  }

  const axisMid = {
    x: (extents.x.min + extents.x.max) / 2,
    y: (extents.y.min + extents.y.max) / 2,
    z: (extents.z.min + extents.z.max) / 2,
  };

  const centerWorld = roughCenter
    .clone()
    .add(axes.x.clone().multiplyScalar(axisMid.x))
    .add(axes.y.clone().multiplyScalar(axisMid.y))
    .add(axes.z.clone().multiplyScalar(axisMid.z));

  const halfExtents = {
    x: Math.max((extents.x.max - extents.x.min) / 2, 0.0001),
    y: Math.max((extents.y.max - extents.y.min) / 2, 0.0001),
    z: Math.max((extents.z.max - extents.z.min) / 2, 0.0001),
  };

  return {
    centerWorld,
    axes,
    halfExtents,
    objectSize: Math.max(halfExtents.x, halfExtents.y, halfExtents.z) * 2,
  };
}

function createLineOverlayMaterial({
  measure,
  confidence,
  directions,
  overrides,
}: {
  measure: DirectionalMeasure;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  overrides?: LineMaterialOverrides;
}) {
  const profile = getVisualProfile(confidence);

  const xStrength = getSideStrengths(confidence.x, directions.x ?? "both");
  const yStrength = getSideStrengths(confidence.y, directions.y ?? "both");
  const zStrength = getSideStrengths(confidence.z, directions.z ?? "both");

  const baseAngle = Math.PI * 0.18;

  const material = new THREE.ShaderMaterial({
    vertexShader: LINE_OVERLAY_VERTEX_SHADER,
    fragmentShader: LINE_OVERLAY_FRAGMENT_SHADER,
    uniforms: {
      uLineColor: { value: new THREE.Color(0x111827) },

      uOpacity: { value: overrides?.opacity ?? profile.lineOpacity },
      uSpacing: { value: overrides?.spacing ?? profile.lineSpacing },
      uThickness: { value: overrides?.thickness ?? profile.lineThickness },

      uEndOpacity: {
        value: overrides?.endOpacity ?? profile.endLineOpacity,
      },
      uEndSpacing: {
        value: overrides?.endSpacing ?? profile.endLineSpacing,
      },
      uEndThickness: {
        value: overrides?.endThickness ?? profile.endLineThickness,
      },
      uEndZoneStart: { value: profile.endZoneStart },
      uEndZoneFeather: { value: profile.endZoneFeather },

      uAngle: { value: baseAngle + (overrides?.angleOffset ?? 0) },

      uBaseWeight: { value: overrides?.baseWeight ?? profile.baseWeight },
      uDirectionalWeight: {
        value: overrides?.directionalWeight ?? profile.directionalWeight,
      },

      uRimStrength: {
        value: overrides?.rimStrength ?? profile.rimStrength,
      },
      uRimPower: {
        value: overrides?.rimPower ?? profile.rimPower,
      },

      uObjectCenter: { value: measure.centerWorld.clone() },

      uAxisX: { value: measure.axes.x.clone() },
      uAxisY: { value: measure.axes.y.clone() },
      uAxisZ: { value: measure.axes.z.clone() },

      uHalfExtentX: { value: measure.halfExtents.x },
      uHalfExtentY: { value: measure.halfExtents.y },
      uHalfExtentZ: { value: measure.halfExtents.z },

      uPositiveStrengthX: { value: xStrength.positive },
      uNegativeStrengthX: { value: xStrength.negative },
      uPositiveStrengthY: { value: yStrength.positive },
      uNegativeStrengthY: { value: yStrength.negative },
      uPositiveStrengthZ: { value: zStrength.positive },
      uNegativeStrengthZ: { value: zStrength.negative },
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



function getGeometryOutlineWidth(
  geometry: THREE.BufferGeometry,
  profile: { outlineWidthRatio: number },
) {
  geometry.computeBoundingSphere();

  const radius = geometry.boundingSphere?.radius ?? 1;

  return Math.max(radius * profile.outlineWidthRatio, 0.0005);
}

function createInvisibleDepthMaterial() {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    colorWrite: false,
  });

  material.userData[FUZZY_ACTIVE_MATERIAL] = true;
  material.userData[FUZZY_VISUAL_CHILD] = true;

  return material;
}

function createOuterOutlineMaterial({
  outlineWidth,
  profile,
}: {
  outlineWidth: number;
  profile: { outlineOpacity: number };
}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: OUTER_OUTLINE_VERTEX_SHADER,
    fragmentShader: OUTER_OUTLINE_FRAGMENT_SHADER,
    uniforms: {
      uOutlineWidth: { value: outlineWidth },
      uOutlineColor: { value: new THREE.Color(0x111827) },
      uOutlineOpacity: { value: profile.outlineOpacity },
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

function createSelectedObjectLineOverlay({
  object,
  annotation,
  axisFrame,
}: {
  object: THREE.Object3D;
  annotation: FuzzyConfidenceAnnotation;
  axisFrame: ConfidenceAxisFrame | undefined;
}) {
  const measure = measureObjectDirectionality(object, axisFrame);

  if (!measure) {
    return null;
  }

  const directions = annotation.directions ?? DEFAULT_DIRECTIONS;
  const profile = getVisualProfile(annotation.confidence);

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

    const outlineGeometry = sourceGeometry.clone();
const outlineWidth = getGeometryOutlineWidth(outlineGeometry, profile) * 1.25;
const shellOutlineProfile = {
  ...profile,
  outlineOpacity: Math.min(profile.outlineOpacity * 1.15, 1.0),
};

const outlineMaterial = createOuterOutlineMaterial({
  outlineWidth,
  profile: shellOutlineProfile,
});

    const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);
    outlineMesh.matrixAutoUpdate = false;
    outlineMesh.matrix.copy(childToObjectMatrix);
    outlineMesh.renderOrder = 1550;
    outlineMesh.frustumCulled = false;
    outlineMesh.userData[FUZZY_VISUAL_CHILD] = true;
    overlayGroup.add(outlineMesh);

    const overlayGeometry = sourceGeometry.clone();
const overlayMaterial = createLineOverlayMaterial({
  measure,
  confidence: annotation.confidence,
  directions,
  overrides: {
    rimStrength: 0.16,
    rimPower: 2.5,
    angleOffset: 0,
  },
});

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

function createDirectionalGhostShells({
  object,
  annotation,
  axisFrame,
}: {
  object: THREE.Object3D;
  annotation: FuzzyConfidenceAnnotation;
  axisFrame: ConfidenceAxisFrame | undefined;
}) {
  const measure = measureObjectDirectionality(object, axisFrame);

  if (!measure) {
    return null;
  }

  const directions = annotation.directions ?? DEFAULT_DIRECTIONS;
  const axesWorld = normalizeAxisFrame(axisFrame);
  const profile = getVisualProfile(annotation.confidence);

  const shellGroup = new THREE.Group();
  shellGroup.userData[FUZZY_VISUAL_CHILD] = true;
  shellGroup.renderOrder = 1500;

  object.updateWorldMatrix(true, true);

  const objectWorldInverse = object.matrixWorld.clone().invert();
  const objectWorldQuaternion = new THREE.Quaternion();
  object.getWorldQuaternion(objectWorldQuaternion);

  const worldToObjectQuaternion = objectWorldQuaternion.clone().invert();

  type AxisConfig = {
    axis: ConfidenceAxis;
    level: ConfidenceLevel;
    direction: ConfidenceDirection;
    worldAxis: THREE.Vector3;
    halfExtent: number;
  };

const axisConfigs = [
  {
    axis: "x",
    level: annotation.confidence.x,
    direction: directions.x ?? "both",
    worldAxis: axesWorld.x,
    halfExtent: measure.halfExtents.x,
  },
  {
    axis: "y",
    level: annotation.confidence.y,
    direction: directions.y ?? "both",
    worldAxis: axesWorld.y,
    halfExtent: measure.halfExtents.y,
  },
  {
    axis: "z",
    level: annotation.confidence.z,
    direction: directions.z ?? "both",
    worldAxis: axesWorld.z,
    halfExtent: measure.halfExtents.z,
  },
] satisfies AxisConfig[];

const activeAxisConfigs = axisConfigs.filter(
  (item) => confidenceToStrength(item.level) > 0,
);

if (activeAxisConfigs.length === 0) {
  return null;
}

const maxStrength = Math.max(
  ...activeAxisConfigs.map((item) => confidenceToStrength(item.level)),
);

const primaryAxisConfigs = activeAxisConfigs
  .filter((item) => confidenceToStrength(item.level) === maxStrength)
  .slice(0, 1);

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

for (const axisConfig of primaryAxisConfigs) {
      const layerCount = getGhostShellLayerCount(axisConfig.level);

      if (layerCount <= 0) {
        continue;
      }

      const localAxis = axisConfig.worldAxis
        .clone()
        .applyQuaternion(worldToObjectQuaternion)
        .normalize();

      const signs = getDirectionSigns(axisConfig.direction);

const stepDistance = Math.max(
  axisConfig.halfExtent * 0.32,
  measure.objectSize * 0.075,
);

      for (let layer = 1; layer <= layerCount; layer += 1) {
        for (const sign of signs) {
          const translationLocal = localAxis
            .clone()
            .multiplyScalar(sign * stepDistance * layer);

          const translationMatrix = new THREE.Matrix4().makeTranslation(
            translationLocal.x,
            translationLocal.y,
            translationLocal.z,
          );

          const shellMatrix = translationMatrix
            .clone()
            .multiply(childToObjectMatrix);

// 0) shell depth mask：不可见，但先写 depth，避免 outline 变成黑色实体块
const depthGeometry = sourceGeometry.clone();
const depthMaterial = createInvisibleDepthMaterial();
const depthMesh = new THREE.Mesh(depthGeometry, depthMaterial);

depthMesh.matrixAutoUpdate = false;
depthMesh.matrix.copy(shellMatrix);
depthMesh.renderOrder = 1460;
depthMesh.frustumCulled = false;
depthMesh.userData[FUZZY_VISUAL_CHILD] = true;

shellGroup.add(depthMesh);

// 1) shell outline：和主体一样的 outline profile
const outlineGeometry = sourceGeometry.clone();
const outlineWidth = getGeometryOutlineWidth(outlineGeometry, profile);
const outlineMaterial = createOuterOutlineMaterial({
  outlineWidth,
  profile,
});

const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);
outlineMesh.matrixAutoUpdate = false;
outlineMesh.matrix.copy(shellMatrix);
outlineMesh.renderOrder = 1480;
outlineMesh.frustumCulled = false;
outlineMesh.userData[FUZZY_VISUAL_CHILD] = true;

shellGroup.add(outlineMesh);

          // 2) shell line：和主体一样的 line profile
          const shellGeometry = sourceGeometry.clone();
const shellLineMaterial = createLineOverlayMaterial({
  measure,
  confidence: annotation.confidence,
  directions,
  overrides: {
    // shell 不要完全 ghost，但要比主体略轻，避免糊成黑块
    opacity: profile.lineOpacity * 0.2,

    // shell 线稍微密一点，让它像外推 boundary
    spacing: Math.max(profile.lineSpacing * 0.72, 5.0),
    thickness: profile.lineThickness * 0.2,

    // 端部强化也保留，但稍微弱一点，不然和主体端部叠黑
    endOpacity: profile.endLineOpacity * 0.72,
    endSpacing: Math.max(profile.endLineSpacing * 0.9, 4.0),
    endThickness: profile.endLineThickness * 1.05,

    // 最关键：角度错开一点，避免 hatch 完全套在一起
    angleOffset: 0.28,

    // shell rim 更强，让 shell 自己的边界被读出来
    rimStrength: 0.95,
    rimPower: 1,

    // shell 的 directional end density 不要太重
    directionalWeight: profile.directionalWeight * 0.2,
  },
});

          const shellLineMesh = new THREE.Mesh(shellGeometry, shellLineMaterial);
          shellLineMesh.matrixAutoUpdate = false;
          shellLineMesh.matrix.copy(shellMatrix);
          shellLineMesh.renderOrder = 1500;
          shellLineMesh.frustumCulled = false;
          shellLineMesh.userData[FUZZY_VISUAL_CHILD] = true;

          shellGroup.add(shellLineMesh);
        }
      }
    }
  });

  if (shellGroup.children.length === 0) {
    return null;
  }

  return shellGroup;
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
    annotations.map((annotation) => annotation.pathKey),
  );

  for (const object of targetObjects) {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") {
      continue;
    }

    const annotation = annotationByPathKey.get(pathKey);

    if (!annotation || !hasUncertainty(annotation.confidence)) {
      continue;
    }

    hideOriginalMaterials(object);

    const shell = createDirectionalGhostShells({
      object,
      annotation,
      axisFrame: axisFramesByPathKey?.get(pathKey),
    });

    if (shell) {
      object.add(shell);
    }

    const overlay = createSelectedObjectLineOverlay({
      object,
      annotation,
      axisFrame: axisFramesByPathKey?.get(pathKey),
    });

    if (overlay) {
      object.add(overlay);
    }
  }
}