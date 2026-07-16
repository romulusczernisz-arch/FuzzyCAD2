import * as THREE from "three";

/**
 * Shared crease-bend math used by BOTH the viewer's live preview and the STL
 * export, so the deployed mesh always matches what the user saw.
 *
 * A bend is defined by:
 * - a crease line (start → end) lying on the part surface,
 * - the cutting plane through that line (planeNormal = creaseDir × surface
 *   normal at the crease),
 * - which side of the plane bends (bendSideSign along planeNormal),
 * - the bend angle delta in radians.
 *
 * Points on the bending side rotate rigidly around the crease line; points on
 * the fixed side are untouched. The math is coordinate-frame agnostic: as long
 * as every input is expressed in the same space (viewer world space for the
 * preview, Onshape assembly space for the export), the result is identical.
 */
export type BendSpec = {
  creaseStart: THREE.Vector3;
  creaseEnd: THREE.Vector3;
  /** Normal of the cutting plane. Does not need to be pre-normalized. */
  planeNormal: THREE.Vector3;
  /** +1 or -1: which side of the plane (along planeNormal) bends. */
  bendSideSign: 1 | -1;
  deltaRad: number;
};

export type BendTransformer = {
  /** Mutates `point` in place if it is on the bending side. */
  apply: (point: THREE.Vector3) => void;
  /** True if the spec is degenerate (zero-length crease etc.). */
  degenerate: boolean;
};

export function makeBendTransformer(spec: BendSpec): BendTransformer {
  const axis = spec.creaseEnd.clone().sub(spec.creaseStart);
  const normal = spec.planeNormal.clone();

  if (axis.lengthSq() < 1e-12 || normal.lengthSq() < 1e-12) {
    return { apply: () => {}, degenerate: true };
  }

  axis.normalize();
  normal.normalize();

  const rotation = new THREE.Quaternion().setFromAxisAngle(
    axis,
    spec.deltaRad,
  );
  const origin = spec.creaseStart.clone();
  const scratch = new THREE.Vector3();

  return {
    degenerate: false,
    apply: (point: THREE.Vector3) => {
      scratch.copy(point).sub(origin);
      const side = scratch.dot(normal) * spec.bendSideSign;

      if (side <= 0) {
        return;
      }

      scratch.applyQuaternion(rotation);
      point.copy(scratch).add(origin);
    },
  };
}

/**
 * Apply a bend to a BufferGeometry IN PLACE. `worldMatrix` maps the
 * geometry's local space into the space the bend spec is expressed in;
 * vertices are transformed there, bent, and mapped back.
 */
export function bendGeometryInPlace(
  geometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
  spec: BendSpec,
) {
  const transformer = makeBendTransformer(spec);

  if (transformer.degenerate) {
    return false;
  }

  const position = geometry.attributes.position;

  if (!position) {
    return false;
  }

  const inverse = worldMatrix.clone().invert();
  const vertex = new THREE.Vector3();

  for (let index = 0; index < position.count; index++) {
    vertex.fromBufferAttribute(position, index);
    vertex.applyMatrix4(worldMatrix);
    transformer.apply(vertex);
    vertex.applyMatrix4(inverse);
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return true;
}
