import * as THREE from "three";

/**
 * Find all Object3D nodes whose userData.fuzzyPathKey is in the given set.
 * Mirrors the traversal pattern used in highlight.ts / lassoObjectSelection.ts.
 */
export function findObjectsByPathKeys(
  scene: THREE.Object3D,
  pathKeys: string[],
): THREE.Object3D[] {
  if (pathKeys.length === 0) {
    return [];
  }

  const wanted = new Set(pathKeys);
  const found: THREE.Object3D[] = [];

  scene.traverse((object) => {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey === "string" && wanted.has(pathKey)) {
      found.push(object);
    }
  });

  return found;
}

/**
 * Translate a set of objects by a world-space delta vector, converting the
 * delta into each object's local (parent) space before applying it.
 */
export function translateObjectsWorld(
  objects: THREE.Object3D[],
  worldDelta: THREE.Vector3,
) {
  if (worldDelta.lengthSq() < 1e-18) {
    return;
  }

  for (const object of objects) {
    const parent = object.parent;

    if (parent) {
      parent.updateMatrixWorld(true);

      const parentInverse = new THREE.Matrix4()
        .copy(parent.matrixWorld)
        .invert();
      const localDelta = worldDelta.clone().transformDirection(parentInverse);

      object.position.add(localDelta);
    } else {
      object.position.add(worldDelta);
    }

    object.matrixWorldNeedsUpdate = true;
  }
}

/**
 * Rotate a set of objects around a world-space pivot point and axis,
 * preserving each object's world position relative to the pivot and
 * applying the same rotation to its orientation.
 */
export function rotateObjectsAroundWorldAxis(
  objects: THREE.Object3D[],
  pivotWorld: THREE.Vector3,
  axisWorld: THREE.Vector3,
  angleRad: number,
) {
  if (Math.abs(angleRad) < 1e-9 || axisWorld.lengthSq() < 1e-12) {
    return;
  }

  const rotation = new THREE.Quaternion().setFromAxisAngle(
    axisWorld.clone().normalize(),
    angleRad,
  );

  for (const object of objects) {
    object.updateMatrixWorld(true);

    const parent = object.parent;
    const parentMatrix = parent ? parent.matrixWorld : new THREE.Matrix4();
    const parentInverse = parentMatrix.clone().invert();

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    object.matrixWorld.decompose(worldPos, worldQuat, worldScale);

    const relative = worldPos.clone().sub(pivotWorld);
    relative.applyQuaternion(rotation);
    const newWorldPos = pivotWorld.clone().add(relative);
    const newWorldQuat = rotation.clone().multiply(worldQuat);

    const newWorldMatrix = new THREE.Matrix4().compose(
      newWorldPos,
      newWorldQuat,
      worldScale,
    );
    const newLocalMatrix = new THREE.Matrix4().multiplyMatrices(
      parentInverse,
      newWorldMatrix,
    );

    newLocalMatrix.decompose(object.position, object.quaternion, object.scale);
    object.matrixWorldNeedsUpdate = true;
  }
}

/**
 * Project a world-space point to pixel coordinates within a canvas-sized
 * rect. Returns null if the point is behind the camera (outside NDC z range).
 * Adapted from lassoObjectSelection.ts's projectWorldPoint.
 */
export function projectToScreen(
  point: THREE.Vector3,
  camera: THREE.Camera,
  rect: { width: number; height: number },
): { x: number; y: number } | null {
  const projected = point.clone().project(camera);

  if (projected.z < -1 || projected.z > 1) {
    return null;
  }

  return {
    x: (projected.x * 0.5 + 0.5) * rect.width,
    y: (-projected.y * 0.5 + 0.5) * rect.height,
  };
}
