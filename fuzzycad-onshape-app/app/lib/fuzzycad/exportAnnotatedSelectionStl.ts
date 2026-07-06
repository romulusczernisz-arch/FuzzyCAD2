import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyPlacements,
  type PartPlacement,
} from "../../components/viewer/placement";
import { prepareRenderableMeshes } from "../../components/viewer/materials";
import type { FuzzyCADUncertaintyAnnotation } from "../uncertainty/document";

function getAnnotatedPathKeys(annotations: FuzzyCADUncertaintyAnnotation[]) {
  const pathKeys = new Set<string>();

  for (const annotation of annotations) {
    if (annotation.type !== "size") continue;

    for (const pathKey of annotation.target.pathKeys) {
      pathKeys.add(pathKey);
    }
  }

  return Array.from(pathKeys);
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

function findTopLevelAnnotatedObjects(
  scene: THREE.Object3D,
  pathKeys: string[],
) {
  const selectedPathKeys = new Set(pathKeys);
  const objects: THREE.Object3D[] = [];

  scene.traverse((object) => {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") return;
    if (!selectedPathKeys.has(pathKey)) return;
    if (hasSelectedAncestor(object, selectedPathKeys)) return;

    objects.push(object);
  });

  return objects;
}

function cloneObjectInWorldSpace(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);

  const clone = object.clone(true);

  clone.name = `FuzzyCAD_Copy__${object.name || "annotated_object"}`;
  clone.matrixAutoUpdate = false;
  clone.matrix.copy(object.matrixWorld);

  clone.userData = {
    fuzzycadGenerated: true,
    sourcePathKey: object.userData?.fuzzyPathKey ?? null,
  };

  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    child.geometry = child.geometry.clone();
    child.material = new THREE.MeshStandardMaterial({
      color: 0xb8beca,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  });

  return clone;
}

function exportSceneToBinaryStl(root: THREE.Object3D) {
  const exporter = new STLExporter();

  const result = exporter.parse(root, {
    binary: true,
  }) as ArrayBuffer | DataView | string;

  if (result instanceof DataView) {
    /**
     * DataView.buffer is typed as ArrayBufferLike, which can include
     * SharedArrayBuffer. BlobPart does not accept that type directly.
     *
     * Copy the visible DataView range into a normal Uint8Array backed by
     * a plain ArrayBuffer.
     */
    const bytes = new Uint8Array(result.byteLength);
    bytes.set(
      new Uint8Array(result.buffer, result.byteOffset, result.byteLength),
    );

    return new Blob([bytes], {
      type: "model/stl",
    });
  }

  if (result instanceof ArrayBuffer) {
    return new Blob([result], {
      type: "model/stl",
    });
  }

  /**
   * Fallback only. Normal path should be binary STL above.
   */
  return new Blob([result], {
    type: "model/stl",
  });
}

export async function exportAnnotatedSelectionStl(input: {
  gltfUrl: string;
  placements: PartPlacement[];
  annotations: FuzzyCADUncertaintyAnnotation[];
}) {
  const annotatedPathKeys = getAnnotatedPathKeys(input.annotations);

  if (annotatedPathKeys.length === 0) {
    return null;
  }

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(input.gltfUrl);
  const scene = gltf.scene.clone(true);

  prepareRenderableMeshes(scene);
  applyPlacements(scene, input.placements ?? []);

  /**
   * Important:
   * Do NOT apply FuzzyCADGeometryViewer's display rotation here.
   *
   * The viewer uses scene.rotation.x = -Math.PI / 2 for browser display.
   * This STL is generated for return-to-Onshape import, so it should stay
   * in source assembly coordinate space.
   */
  scene.updateMatrixWorld(true);

  const targetObjects = findTopLevelAnnotatedObjects(scene, annotatedPathKeys);

  if (targetObjects.length === 0) {
    return null;
  }

  const exportRoot = new THREE.Group();
  exportRoot.name = "FuzzyCAD_Annotated_Selection";

  for (const object of targetObjects) {
    exportRoot.add(cloneObjectInWorldSpace(object));
  }

  exportRoot.updateMatrixWorld(true);

  return exportSceneToBinaryStl(exportRoot);
}