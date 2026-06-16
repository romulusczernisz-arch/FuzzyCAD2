import * as THREE from "three";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import { findObjectsByPathKeys, translateObjectsWorld } from "./manipulation";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export type AxialStretchRolePlan = {
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
  fixedAnchorPathKeys: string[];
  excludedPathKeys: string[];
};

type MeshPreviewSnapshot = {
  cloneMesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  originalPositions: Float32Array;
  originalMatrixWorld: THREE.Matrix4;
  originalInverseMatrixWorld: THREE.Matrix4;
};

type StretchPreview = {
  originalPathKey: string;
  clone: THREE.Object3D;
  summary: AxialStretchObjectSummary;
  meshes: MeshPreviewSnapshot[];
  upperEndWorld: THREE.Vector3;
  lowerEndWorld: THREE.Vector3;
  axisFromFixedToMoving: THREE.Vector3;
  axisLength: number;
};

type FollowPreview = {
  originalPathKey: string;
  clone: THREE.Object3D;
  originalLocalPosition: THREE.Vector3;
  originalAnchorWorld: THREE.Vector3;
  targetIndex: number;
};

export type AxialStretchPreviewSession = {
  group: THREE.Group;
  stretchPreviews: StretchPreview[];
  followPreviews: FollowPreview[];
};

type PreviewRole = "stretch" | "follow";

function toVector(tuple: [number, number, number]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getPathKey(object: THREE.Object3D) {
  const pathKey = object.userData?.fuzzyPathKey;
  return typeof pathKey === "string" ? pathKey : "";
}

function findSummary(
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
) {
  return objectSummaries.find((summary) => summary.pathKey === pathKey) ?? null;
}

function getUpperLowerEnds(summary: AxialStretchObjectSummary) {
  const a = toVector(summary.negativeEndWorld);
  const b = toVector(summary.positiveEndWorld);

  if (a.y >= b.y) {
    return {
      upperEndWorld: a,
      lowerEndWorld: b,
    };
  }

  return {
    upperEndWorld: b,
    lowerEndWorld: a,
  };
}

function getFollowAnchorWorld(
  summary: AxialStretchObjectSummary | null,
  targetLowerEndWorld: THREE.Vector3,
) {
  if (!summary) {
    return null;
  }

  const negativeEnd = toVector(summary.negativeEndWorld);
  const positiveEnd = toVector(summary.positiveEndWorld);

  return negativeEnd.distanceToSquared(targetLowerEndWorld) <=
    positiveEnd.distanceToSquared(targetLowerEndWorld)
    ? negativeEnd
    : positiveEnd;
}

function createInvisiblePreviewMaterial(color: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.005,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }

    return;
  }

  material.dispose();
}

function isPreviewLine(object: THREE.Object3D) {
  return object instanceof LineSegments2 || object.userData?.fuzzycadPreviewLine === true;
}

function collectMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  root.traverse((object) => {
    if (isPreviewLine(object)) {
      return;
    }

    if (object instanceof THREE.Mesh) {
      meshes.push(object);
    }
  });

  return meshes;
}

function cloneObjectForPreview(
  scene: THREE.Object3D,
  original: THREE.Object3D,
  role: PreviewRole,
) {
  scene.updateMatrixWorld(true);
  original.updateMatrixWorld(true);

  const clone = original.clone(true);
  clone.name = `${original.name || original.type} ${role} Preview`;

  const sceneInverse = scene.matrixWorld.clone().invert();
  const localMatrix = sceneInverse.multiply(original.matrixWorld);

  localMatrix.decompose(clone.position, clone.quaternion, clone.scale);

  const previewColor = PREVIEW_LINE_COLOR;

  clone.traverse((object) => {
    object.userData = {
      ...object.userData,
      fuzzycadPreview: true,
    };

    // Prevent preview clones from being selected/highlighted as real objects.
    delete object.userData.fuzzyPathKey;

    if (isPreviewLine(object)) {
      return;
    }

    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.geometry = object.geometry.clone();
    object.material = createInvisiblePreviewMaterial(previewColor);
    object.castShadow = false;
    object.receiveShadow = false;
  });

  // Important: do NOT add dashed overlays inside clone.traverse().
  // Add them after traversal, otherwise the newly added LineSegments2 children
  // can be traversed again and create an infinite recursion.
  for (const mesh of collectMeshes(clone)) {
    addWideDashedOverlay(mesh);
  }

  clone.matrixWorldNeedsUpdate = true;

  return clone;
}

const PREVIEW_LINE_COLOR = 0x111111;

function createWideDashedMaterial() {
  return new LineMaterial({
    color: PREVIEW_LINE_COLOR,
    linewidth: 3.5,
    dashed: true,
    dashSize: 8,
    gapSize: 5,
    dashScale: 1,
    worldUnits: false,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
    alphaToCoverage: true,
  });
}

function createWideDashedGeometry(mesh: THREE.Mesh) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 20);
  const edgePositions = edges.getAttribute("position");
  const positions: number[] = [];

  for (let index = 0; index < edgePositions.count; index += 1) {
    positions.push(
      edgePositions.getX(index),
      edgePositions.getY(index),
      edgePositions.getZ(index),
    );
  }

  edges.dispose();

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);

  return geometry;
}

function addWideDashedOverlay(mesh: THREE.Mesh) {
  const geometry = createWideDashedGeometry(mesh);
  const material = createWideDashedMaterial();
  const line = new LineSegments2(geometry, material);

  line.name = "FuzzyCAD Wide Dashed Preview Edges";
  line.userData.fuzzycadPreviewLine = true;
  line.computeLineDistances();
  line.renderOrder = 999;

  // Important: line is child of mesh, so it uses the mesh's local coordinate system.
  mesh.add(line);

  return line;
}

function refreshWideDashedOverlay(mesh: THREE.Mesh) {
  for (const child of mesh.children) {
    if (!(child instanceof LineSegments2)) {
      continue;
    }

    if (!child.userData.fuzzycadPreviewLine) {
      continue;
    }

    child.geometry.dispose();
    child.geometry = createWideDashedGeometry(mesh);
    child.computeLineDistances();
  }
}

function createMeshPreviewSnapshots(
  originalRoot: THREE.Object3D,
  cloneRoot: THREE.Object3D,
) {
  const originalMeshes = collectMeshes(originalRoot);
  const cloneMeshes = collectMeshes(cloneRoot);
  const count = Math.min(originalMeshes.length, cloneMeshes.length);
  const snapshots: MeshPreviewSnapshot[] = [];

  for (let index = 0; index < count; index += 1) {
    const originalMesh = originalMeshes[index];
    const cloneMesh = cloneMeshes[index];

    originalMesh.updateMatrixWorld(true);

    const position = cloneMesh.geometry.attributes.position;

    if (!(position instanceof THREE.BufferAttribute)) {
      continue;
    }

    snapshots.push({
      cloneMesh,
      geometry: cloneMesh.geometry,
      originalPositions: Float32Array.from(position.array as ArrayLike<number>),
      originalMatrixWorld: originalMesh.matrixWorld.clone(),
      originalInverseMatrixWorld: originalMesh.matrixWorld.clone().invert(),
    });
  }

  return snapshots;
}

function createStretchPreview(
  scene: THREE.Object3D,
  group: THREE.Group,
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
): StretchPreview | null {
  const summary = findSummary(objectSummaries, pathKey);

  if (!summary) {
    return null;
  }

  const original = findObjectsByPathKeys(scene, [pathKey])[0];

  if (!original) {
    return null;
  }

  const clone = cloneObjectForPreview(scene, original, "stretch");
  const meshes = createMeshPreviewSnapshots(original, clone);

  if (meshes.length === 0) {
    return null;
  }

  const { upperEndWorld, lowerEndWorld } = getUpperLowerEnds(summary);
  const axisFromFixedToMoving = lowerEndWorld.clone().sub(upperEndWorld);
  const axisLength = Math.max(axisFromFixedToMoving.length(), 1e-6);

  axisFromFixedToMoving.normalize();

  group.add(clone);

  return {
    originalPathKey: pathKey,
    clone,
    summary,
    meshes,
    upperEndWorld,
    lowerEndWorld,
    axisFromFixedToMoving,
    axisLength,
  };
}

function getMovingDeltaForTarget(
  target: StretchPreview,
  verticalDelta: number,
) {
  // Y-case only.
  // Positive value = extend downward from fixed upper side.
  const yContribution = Math.max(
    Math.abs(target.axisFromFixedToMoving.y),
    0.08,
  );

  const axialDelta = verticalDelta / yContribution;

  return target.axisFromFixedToMoving.clone().multiplyScalar(axialDelta);
}

function getObjectCenterWorld(object: THREE.Object3D) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();

  box.getCenter(center);

  return center;
}

function findNearestStretchTargetIndex(
  object: THREE.Object3D,
  stretchPreviews: StretchPreview[],
) {
  const center = getObjectCenterWorld(object);

  let bestIndex = 0;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (let index = 0; index < stretchPreviews.length; index += 1) {
    const distanceSq = center.distanceToSquared(
      stretchPreviews[index].lowerEndWorld,
    );

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function createFollowPreviews(
  scene: THREE.Object3D,
  group: THREE.Group,
  objectSummaries: AxialStretchObjectSummary[],
  plan: AxialStretchRolePlan,
  stretchPreviews: StretchPreview[],
): FollowPreview[] {
  if (stretchPreviews.length === 0) {
    return [];
  }

  const originals = findObjectsByPathKeys(scene, plan.moveWithEndPathKeys);

  return originals.map((original) => {
    const originalPathKey = getPathKey(original);
    const originalSummary = findSummary(objectSummaries, originalPathKey);
    const targetIndex = findNearestStretchTargetIndex(
      original,
      stretchPreviews,
    );
    const target = stretchPreviews[targetIndex];
    const clone = cloneObjectForPreview(scene, original, "follow");

    group.add(clone);

    return {
      originalPathKey,
      clone,
      originalLocalPosition: clone.position.clone(),
      originalAnchorWorld:
        getFollowAnchorWorld(originalSummary, target.lowerEndWorld) ??
        getObjectCenterWorld(original),
      targetIndex,
    };
  });
}

export function createAxialStretchPreviewSession(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  plan: AxialStretchRolePlan,
): AxialStretchPreviewSession | null {
  const group = new THREE.Group();
  group.name = "FuzzyCAD Height Preview";
  group.userData.fuzzycadPreview = true;

  const stretchPreviews = plan.stretchTargetPathKeys
    .map((pathKey) =>
      createStretchPreview(scene, group, objectSummaries, pathKey),
    )
    .filter((item): item is StretchPreview => item !== null);

  if (stretchPreviews.length === 0) {
    return null;
  }

  const followPreviews = createFollowPreviews(
    scene,
    group,
    objectSummaries,
    plan,
    stretchPreviews,
  );

  return {
    group,
    stretchPreviews,
    followPreviews,
  };
}

function updateStretchPreview(preview: StretchPreview, verticalDelta: number) {
  const movingDelta = getMovingDeltaForTarget(preview, verticalDelta);
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const offsetFromUpper = new THREE.Vector3();

  for (const meshSnapshot of preview.meshes) {
    const position = meshSnapshot.geometry.attributes.position;

    if (!(position instanceof THREE.BufferAttribute)) {
      continue;
    }

    const array = position.array as Float32Array;
    const original = meshSnapshot.originalPositions;

    for (let index = 0; index < position.count; index += 1) {
      const base = index * 3;

      localPoint.set(original[base], original[base + 1], original[base + 2]);

      worldPoint
        .copy(localPoint)
        .applyMatrix4(meshSnapshot.originalMatrixWorld);

      offsetFromUpper.copy(worldPoint).sub(preview.upperEndWorld);

      const t = clamp01(
        offsetFromUpper.dot(preview.axisFromFixedToMoving) / preview.axisLength,
      );

      worldPoint.addScaledVector(movingDelta, t);

      localPoint
        .copy(worldPoint)
        .applyMatrix4(meshSnapshot.originalInverseMatrixWorld);

      array[base] = localPoint.x;
      array[base + 1] = localPoint.y;
      array[base + 2] = localPoint.z;
    }

    position.needsUpdate = true;
    meshSnapshot.geometry.computeBoundingBox();
    meshSnapshot.geometry.computeBoundingSphere();

    refreshWideDashedOverlay(meshSnapshot.cloneMesh);
  }
}

function updateFollowPreviews(
  session: AxialStretchPreviewSession,
  verticalDelta: number,
) {
  for (const follower of session.followPreviews) {
    const target = session.stretchPreviews[follower.targetIndex];

    if (!target) {
      continue;
    }

    const movingDelta = getMovingDeltaForTarget(target, verticalDelta);

    // Align follower's original attachment anchor to the stretched leg's
    // new moving end. This avoids double-moving or drifting away.
    const desiredAnchorWorld = target.lowerEndWorld.clone().add(movingDelta);
    const anchorDelta = desiredAnchorWorld.sub(follower.originalAnchorWorld);

    follower.clone.position.copy(follower.originalLocalPosition);
    follower.clone.matrixWorldNeedsUpdate = true;

    translateObjectsWorld([follower.clone], anchorDelta);
  }
}

export function updateAxialStretchPreviewSession(
  session: AxialStretchPreviewSession,
  verticalDelta: number,
) {
  for (const preview of session.stretchPreviews) {
    updateStretchPreview(preview, verticalDelta);
  }

  updateFollowPreviews(session, verticalDelta);
}

export function disposeAxialStretchPreviewSession(
  session: AxialStretchPreviewSession,
) {
  if (session.group.parent) {
    session.group.parent.remove(session.group);
  }

 session.group.traverse((object) => {
  if (object instanceof LineSegments2 || object instanceof THREE.LineSegments) {
    object.geometry.dispose();

    if (object.material) {
      disposeMaterial(object.material);
    }

    return;
  }

  if (object instanceof THREE.Mesh) {
    object.geometry.dispose();

    if (object.material) {
      disposeMaterial(object.material);
    }
  }
});



}

export function getAxialStretchPreviewHandle(
  session: AxialStretchPreviewSession,
) {
  const upper = new THREE.Vector3();
  const lower = new THREE.Vector3();

  for (const preview of session.stretchPreviews) {
    upper.add(preview.upperEndWorld);
    lower.add(preview.lowerEndWorld);
  }

  upper.multiplyScalar(1 / session.stretchPreviews.length);
  lower.multiplyScalar(1 / session.stretchPreviews.length);

  // For now: keep using the existing SizingHandle API.
  // Next step: replace this with a fixed centered slider.
  const sideOffset = new THREE.Vector3(0.14, 0, 0);

  return {
    baseWorld: upper.clone().add(sideOffset),
    axisWorld: new THREE.Vector3(0, -1, 0),
    length: Math.max(upper.distanceTo(lower), 0.001),
  };
}
