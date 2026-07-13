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

/**
 * Rotation transform for angle annotations: rotates the part2 object so that
 * the angle between face1Normal and face2Normal equals targetAngleDeg.
 *
 * All vectors are in Onshape assembly coordinate space (no viewer -π/2 rotation).
 * Returns null if the annotation lacks the geometry data needed.
 */
function buildAngleRotationTransform(annotation: {
  angleDeg: number;
  face1Normal?: [number, number, number];
  face2Normal?: [number, number, number];
  pivotPoint?: [number, number, number];
}): THREE.Matrix4 | null {
  const { face1Normal, face2Normal, pivotPoint } = annotation;
  if (!face1Normal || !face2Normal || !pivotPoint) return null;

  const n1 = new THREE.Vector3(...face1Normal).normalize();
  const n2 = new THREE.Vector3(...face2Normal).normalize();

  // Current angle between face normals
  const currentAngleRad = Math.acos(
    Math.max(-1, Math.min(1, n1.dot(n2))),
  );

  // Target angle in radians
  const targetAngleRad = (annotation.angleDeg * Math.PI) / 180;
  const deltaRad = targetAngleRad - currentAngleRad;

  if (Math.abs(deltaRad) < 1e-6) return null; // no change needed

  // Hinge axis: perpendicular to both normals
  let hinge = new THREE.Vector3().crossVectors(n1, n2);
  if (hinge.lengthSq() < 0.0001) {
    hinge = Math.abs(n1.y) < 0.9
      ? new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n1)
      : new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), n1);
  }
  hinge.normalize();

  const pivot = new THREE.Vector3(...pivotPoint);

  // Build: translate-to-origin → rotate → translate-back
  const toOrigin = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const rotation = new THREE.Matrix4().makeRotationAxis(hinge, deltaRad);
  const fromOrigin = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);

  return fromOrigin.multiply(rotation).multiply(toOrigin);
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

  // Collect angle-annotated parts: include part1 as-is, part2 with rotation
  const angleAnnotations = input.annotations.filter(
    (a): a is import("../uncertainty/document").AngleUncertaintyAnnotation =>
      a.type === "angle",
  );
  const anglePart1Keys = new Set(angleAnnotations.map((a) => a.target.part1PathKey));
  const anglePart2Keys = new Set(angleAnnotations.map((a) => a.target.part2PathKey));

  const allStaticPathKeys = [
    ...new Set([...sizePathKeys, ...anglePart1Keys]),
  ];

  const hasContent = allStaticPathKeys.length > 0 || anglePart2Keys.size > 0;
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

  // Static objects (size annotations + angle part1): clone as-is
  const staticObjects = findTopLevelAnnotatedObjects(scene, allStaticPathKeys);
  for (const object of staticObjects) {
    exportRoot.add(cloneObjectInWorldSpace(object));
  }

  // Angle part2 objects: clone with rotation applied so target angle is achieved
  for (const annotation of angleAnnotations) {
    const part2Objects = findTopLevelAnnotatedObjects(scene, [
      annotation.target.part2PathKey,
    ]);

    const transform = buildAngleRotationTransform(annotation);

    for (const object of part2Objects) {
      const clone = cloneObjectInWorldSpace(object, transform ?? undefined);
      clone.name = `FuzzyCAD_AngleRotated__${object.name || annotation.id}`;
      exportRoot.add(clone);
    }
  }

  if (exportRoot.children.length === 0) return null;

  exportRoot.updateMatrixWorld(true);

  return exportSceneToBinaryStl(exportRoot);
}