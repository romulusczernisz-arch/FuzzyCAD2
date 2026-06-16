import * as THREE from "three";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import {
  findObjectsByPathKeys,
  translateObjectsWorld,
} from "./manipulation";

export type AxialStretchRolePlan = {
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
  fixedAnchorPathKeys: string[];
  excludedPathKeys: string[];
};

type MeshSnapshot = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  originalPositions: Float32Array;
  originalMatrixWorld: THREE.Matrix4;
  originalInverseMatrixWorld: THREE.Matrix4;
};

type StretchTargetSnapshot = {
  pathKey: string;
  summary: AxialStretchObjectSummary;
  meshes: MeshSnapshot[];
  upperEndWorld: THREE.Vector3;
  lowerEndWorld: THREE.Vector3;
  axisFromFixedToMoving: THREE.Vector3;
  axisLength: number;
};

type MoveFollowerSnapshot = {
  object: THREE.Object3D;
  originalLocalPosition: THREE.Vector3;
  targetIndex: number;
};

export type AxialStretchSession = {
  stretchTargets: StretchTargetSnapshot[];
  moveFollowers: MoveFollowerSnapshot[];
};

function toVector(tuple: [number, number, number]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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

function findSummary(
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
) {
  return objectSummaries.find((summary) => summary.pathKey === pathKey) ?? null;
}

function collectMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshes.push(object);
    }
  });

  return meshes;
}

function snapshotMesh(mesh: THREE.Mesh): MeshSnapshot | null {
  mesh.updateMatrixWorld(true);

  // Important: clone geometry before changing vertices, otherwise shared glTF
  // geometry may affect other instances.
  mesh.geometry = mesh.geometry.clone();

  const position = mesh.geometry.attributes.position;

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  return {
    mesh,
    geometry: mesh.geometry,
    originalPositions: new Float32Array(position.array as ArrayLike<number>),
    originalMatrixWorld: mesh.matrixWorld.clone(),
    originalInverseMatrixWorld: mesh.matrixWorld.clone().invert(),
  };
}

function createStretchTargetSnapshot(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
): StretchTargetSnapshot | null {
  const summary = findSummary(objectSummaries, pathKey);

  if (!summary) {
    return null;
  }

  const objects = findObjectsByPathKeys(scene, [pathKey]);

  if (objects.length === 0) {
    return null;
  }

  const { upperEndWorld, lowerEndWorld } = getUpperLowerEnds(summary);
  const axisFromFixedToMoving = lowerEndWorld.clone().sub(upperEndWorld);
  const axisLength = Math.max(axisFromFixedToMoving.length(), 1e-6);

  axisFromFixedToMoving.normalize();

  const meshes = objects
    .flatMap((object) => collectMeshes(object))
    .map(snapshotMesh)
    .filter((item): item is MeshSnapshot => item !== null);

  if (meshes.length === 0) {
    return null;
  }

  return {
    pathKey,
    summary,
    meshes,
    upperEndWorld,
    lowerEndWorld,
    axisFromFixedToMoving,
    axisLength,
  };
}

function getMovingDeltaForTarget(
  target: StretchTargetSnapshot,
  verticalDelta: number,
) {
  // Y-case: positive height delta means extending downward from the upper
  // fixed side. Convert desired vertical change into each object's own axial
  // movement so slanted rods extend along their principal direction.
  const yContribution = Math.max(
    Math.abs(target.axisFromFixedToMoving.y),
    0.08,
  );

  const axialDelta = verticalDelta / yContribution;

  return target.axisFromFixedToMoving.clone().multiplyScalar(axialDelta);
}

function findNearestStretchTargetIndex(
  object: THREE.Object3D,
  stretchTargets: StretchTargetSnapshot[],
) {
  object.updateMatrixWorld(true);

  const center = new THREE.Vector3();
  new THREE.Box3().setFromObject(object).getCenter(center);

  let bestIndex = 0;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (let index = 0; index < stretchTargets.length; index += 1) {
    const distanceSq = center.distanceToSquared(
      stretchTargets[index].lowerEndWorld,
    );

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function createMoveFollowerSnapshots(
  scene: THREE.Object3D,
  plan: AxialStretchRolePlan,
  stretchTargets: StretchTargetSnapshot[],
): MoveFollowerSnapshot[] {
  if (stretchTargets.length === 0) {
    return [];
  }

  const objects = findObjectsByPathKeys(scene, plan.moveWithEndPathKeys);

  return objects.map((object) => ({
    object,
    originalLocalPosition: object.position.clone(),
    targetIndex: findNearestStretchTargetIndex(object, stretchTargets),
  }));
}

export function createAxialStretchSession(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  plan: AxialStretchRolePlan,
): AxialStretchSession | null {
  const stretchTargets = plan.stretchTargetPathKeys
    .map((pathKey) =>
      createStretchTargetSnapshot(scene, objectSummaries, pathKey),
    )
    .filter(
      (target): target is StretchTargetSnapshot => target !== null,
    );

  if (stretchTargets.length === 0) {
    return null;
  }

  return {
    stretchTargets,
    moveFollowers: createMoveFollowerSnapshots(scene, plan, stretchTargets),
  };
}

function updateStretchTarget(
  target: StretchTargetSnapshot,
  verticalDelta: number,
) {
  const movingDelta = getMovingDeltaForTarget(target, verticalDelta);
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const offsetFromUpper = new THREE.Vector3();

  for (const meshSnapshot of target.meshes) {
    const position = meshSnapshot.geometry.attributes.position;

    if (!(position instanceof THREE.BufferAttribute)) {
      continue;
    }

    const array = position.array as Float32Array;
    const original = meshSnapshot.originalPositions;

    for (let index = 0; index < position.count; index += 1) {
      const base = index * 3;

      localPoint.set(original[base], original[base + 1], original[base + 2]);

      worldPoint.copy(localPoint).applyMatrix4(
        meshSnapshot.originalMatrixWorld,
      );

      offsetFromUpper.copy(worldPoint).sub(target.upperEndWorld);

      const t = clamp01(
        offsetFromUpper.dot(target.axisFromFixedToMoving) /
          target.axisLength,
      );

      worldPoint.addScaledVector(movingDelta, t);

      localPoint.copy(worldPoint).applyMatrix4(
        meshSnapshot.originalInverseMatrixWorld,
      );

      array[base] = localPoint.x;
      array[base + 1] = localPoint.y;
      array[base + 2] = localPoint.z;
    }

    position.needsUpdate = true;
    meshSnapshot.geometry.computeBoundingBox();
    meshSnapshot.geometry.computeBoundingSphere();
  }
}

function updateMoveFollowers(
  session: AxialStretchSession,
  verticalDelta: number,
) {
  for (const follower of session.moveFollowers) {
    const target = session.stretchTargets[follower.targetIndex];

    if (!target) {
      continue;
    }

    follower.object.position.copy(follower.originalLocalPosition);

    translateObjectsWorld(follower.object ? [follower.object] : [], getMovingDeltaForTarget(target, verticalDelta));
  }
}

export function updateAxialStretchSession(
  session: AxialStretchSession,
  verticalDelta: number,
) {
  for (const target of session.stretchTargets) {
    updateStretchTarget(target, verticalDelta);
  }

  updateMoveFollowers(session, verticalDelta);
}

export function restoreAxialStretchSession(session: AxialStretchSession) {
  for (const target of session.stretchTargets) {
    for (const meshSnapshot of target.meshes) {
      const position = meshSnapshot.geometry.attributes.position;

      if (!(position instanceof THREE.BufferAttribute)) {
        continue;
      }

      const array = position.array as Float32Array;
      array.set(meshSnapshot.originalPositions);

      position.needsUpdate = true;
      meshSnapshot.geometry.computeBoundingBox();
      meshSnapshot.geometry.computeBoundingSphere();
    }
  }

  for (const follower of session.moveFollowers) {
    follower.object.position.copy(follower.originalLocalPosition);
    follower.object.matrixWorldNeedsUpdate = true;
  }
}

export function getAxialStretchSessionHandle(session: AxialStretchSession) {
  const upper = new THREE.Vector3();
  const lower = new THREE.Vector3();

  for (const target of session.stretchTargets) {
    upper.add(target.upperEndWorld);
    lower.add(target.lowerEndWorld);
  }

  upper.multiplyScalar(1 / session.stretchTargets.length);
  lower.multiplyScalar(1 / session.stretchTargets.length);

  return {
    baseWorld: upper,
    axisWorld: new THREE.Vector3(0, -1, 0),
    length: Math.max(upper.y - lower.y, 0.001),
  };
}