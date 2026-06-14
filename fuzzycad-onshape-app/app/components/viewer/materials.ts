import * as THREE from "three";

function cloneDoubleSidedMaterial<T extends THREE.Material>(material: T): T {
  const cloned = material.clone() as T;
  cloned.side = THREE.DoubleSide;
  return cloned;
}

export function prepareRenderableMeshes(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.castShadow = true;
    object.receiveShadow = true;

    if (!object.material) {
      return;
    }

    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) =>
        cloneDoubleSidedMaterial(material)
      );
    } else {
      object.material = cloneDoubleSidedMaterial(object.material);
    }
  });
}