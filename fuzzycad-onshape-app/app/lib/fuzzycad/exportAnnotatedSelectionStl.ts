import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyPlacements,
  type PartPlacement,
} from "../../components/viewer/placement";
import { prepareRenderableMeshes } from "../../components/viewer/materials";
import type {
  BendUncertaintyAnnotation,
  FuzzyCADUncertaintyAnnotation,
} from "../uncertainty/document";
import { bendGeometryInPlace } from "./bendDeform";

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

function cloneObjectInWorldSpace(
  object: THREE.Object3D,
  extraTransform?: THREE.Matrix4,
) {
  object.updateWorldMatrix(true, true);

  const clone = object.clone(true);

  clone.name = `FuzzyCAD_Copy__${object.name || "annotated_object"}`;
  clone.matrixAutoUpdate = false;

  // Apply world matrix, then optionally an extra rotation on top
  const matrix = object.matrixWorld.clone();
  if (extraTransform) {
    // extraTransform is in Onshape world space, pre-multiply so it wraps the world matrix
    matrix.premultiply(extraTransform);
  }
  clone.matrix.copy(matrix);

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

/**
 * Clone an object with a crease-bend deformation applied.
 *
 * The clone's geometry is baked into world (Onshape assembly) space first,
 * then bent with the shared bendDeform math — the same formula the viewer
 * preview uses, just in Onshape space instead of viewer space.
 */
function cloneObjectWithBend(
  object: THREE.Object3D,
  annotation: BendUncertaintyAnnotation,
): THREE.Object3D | null {
  object.updateWorldMatrix(true, true);

  const group = new THREE.Group();
  group.name = `FuzzyCAD_Bent__${object.name || annotation.id}`;
  group.userData = {
    fuzzycadGenerated: true,
    sourcePathKey: object.userData?.fuzzyPathKey ?? null,
  };

  const spec = {
    creaseStart: new THREE.Vector3(...annotation.creaseStart),
    creaseEnd: new THREE.Vector3(...annotation.creaseEnd),
    planeNormal: new THREE.Vector3(...annotation.planeNormal),
    bendSideSign: annotation.bendSideSign,
    deltaRad: (annotation.deltaDeg * Math.PI) / 180,
    profile: annotation.profile,
    bandWidth: annotation.bandWidth,
  };

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    // Bake the mesh into world space so the bend spec (stored in Onshape
    // assembly space) applies directly.
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);

    bendGeometryInPlace(geometry, new THREE.Matrix4(), spec);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xb8beca,
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );

    group.add(mesh);
  });

  return group.children.length > 0 ? group : null;
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
  const sizePathKeys = getAnnotatedPathKeys(input.annotations);

  /**
   * Angle (rotate) annotations are intentionally ABSENT here: rotated parts
   * are deployed natively by the save route (a new instance of the original
   * part with a rotated occurrence transform), so they stay parametric and
   * editable. Only size marks and bend deformations need mesh export.
   */
  const bendAnnotations = input.annotations.filter(
    (a): a is import("../uncertainty/document").BendUncertaintyAnnotation =>
      a.type === "bend",
  );

  const allStaticPathKeys = [...new Set(sizePathKeys)];

  const hasContent =
    allStaticPathKeys.length > 0 || bendAnnotations.length > 0;
  if (!hasContent) return null;

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

  const exportRoot = new THREE.Group();
  exportRoot.name = "FuzzyCAD_Annotated_Selection";

  // Static objects (size annotations): clone as-is
  const staticObjects = findTopLevelAnnotatedObjects(scene, allStaticPathKeys);
  for (const object of staticObjects) {
    exportRoot.add(cloneObjectInWorldSpace(object));
  }

  // Bend objects: clone with per-vertex crease deformation applied.
  for (const annotation of bendAnnotations) {
    const bendObjects = findTopLevelAnnotatedObjects(scene, [
      annotation.target.pathKey,
    ]);

    for (const object of bendObjects) {
      const bent = cloneObjectWithBend(object, annotation);
      if (bent) {
        bent.name = `FuzzyCAD_Bent__${object.name || annotation.id}`;
        exportRoot.add(bent);
      }
    }
  }

  if (exportRoot.children.length === 0) return null;

  exportRoot.updateMatrixWorld(true);

  return exportSceneToBinaryStl(exportRoot);
}