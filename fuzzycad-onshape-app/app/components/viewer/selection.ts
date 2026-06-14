import * as THREE from "three";

export function findFuzzyPathKey(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;

  while (current) {
    const pathKey = current.userData?.fuzzyPathKey;

    if (typeof pathKey === "string" && pathKey.length > 0) {
      return pathKey;
    }

    current = current.parent;
  }

  return null;
}