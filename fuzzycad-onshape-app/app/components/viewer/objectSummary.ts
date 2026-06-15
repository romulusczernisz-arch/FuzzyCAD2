import * as THREE from "three";
import type {
  AxialStretchObjectSummary,
  Vec3Tuple,
} from "../../lib/operations/axialStretchTypes";

const EPSILON = 1e-6;
const HEIGHT_DIRECTION = new THREE.Vector3(0, 1, 0);

function toTuple(vector: THREE.Vector3): Vec3Tuple {
  return [vector.x, vector.y, vector.z];
}

function safeNormalize(vector: THREE.Vector3) {
  if (vector.lengthSq() < EPSILON) {
    return new THREE.Vector3(0, 1, 0);
  }

  return vector.clone().normalize();
}

function collectWorldPoints(object: THREE.Object3D) {
  const points: THREE.Vector3[] = [];
  const temp = new THREE.Vector3();

  object.updateMatrixWorld(true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const position = child.geometry.attributes.position;

    if (!position) {
      return;
    }

    // Avoid sending too many vertices into the PCA calculation.
    const step = Math.max(1, Math.floor(position.count / 4000));

    for (let index = 0; index < position.count; index += step) {
      temp.fromBufferAttribute(position, index);
      points.push(temp.clone().applyMatrix4(child.matrixWorld));
    }
  });

  return points;
}

function computePointCenter(points: THREE.Vector3[]) {
  const center = new THREE.Vector3();

  for (const point of points) {
    center.add(point);
  }

  center.multiplyScalar(1 / Math.max(points.length, 1));

  return center;
}

function computePrincipalAxis(points: THREE.Vector3[]) {
  if (points.length < 3) {
    return HEIGHT_DIRECTION.clone();
  }

  const center = computePointCenter(points);

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;

  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    const z = point.z - center.z;

    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }

  // Power iteration on the covariance matrix.
  let axis = new THREE.Vector3(1, 1, 1).normalize();

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const next = new THREE.Vector3(
      xx * axis.x + xy * axis.y + xz * axis.z,
      xy * axis.x + yy * axis.y + yz * axis.z,
      xz * axis.x + yz * axis.y + zz * axis.z,
    );

    axis = safeNormalize(next);
  }

  // Make axis orientation stable: prefer pointing generally upward.
  if (axis.dot(HEIGHT_DIRECTION) < 0) {
    axis.multiplyScalar(-1);
  }

  return axis;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * ratio)),
  );

  return sorted[index];
}

function computeAxisMetrics(points: THREE.Vector3[], axis: THREE.Vector3) {
  const center = computePointCenter(points);

  let minProjection = Number.POSITIVE_INFINITY;
  let maxProjection = Number.NEGATIVE_INFINITY;
  const radialDistances: number[] = [];

  for (const point of points) {
    const offset = point.clone().sub(center);
    const projection = offset.dot(axis);

    minProjection = Math.min(minProjection, projection);
    maxProjection = Math.max(maxProjection, projection);

    const closestPointOnAxis = axis.clone().multiplyScalar(projection);
    const radialVector = offset.sub(closestPointOnAxis);
    radialDistances.push(radialVector.length());
  }

  if (!Number.isFinite(minProjection) || !Number.isFinite(maxProjection)) {
    minProjection = 0;
    maxProjection = 0;
  }

  const axisLength = Math.max(maxProjection - minProjection, EPSILON);

  // Use 95th percentile instead of max, so one noisy vertex does not dominate.
  const crossSectionRadius = Math.max(percentile(radialDistances, 0.95), EPSILON);
  const crossSectionSize = crossSectionRadius * 2;
  const elongationRatio = axisLength / Math.max(crossSectionSize, EPSILON);

  const negativeEndWorld = center.clone().add(axis.clone().multiplyScalar(minProjection));
  const positiveEndWorld = center.clone().add(axis.clone().multiplyScalar(maxProjection));

  return {
    axisLength,
    crossSectionSize,
    elongationRatio,
    negativeEndWorld,
    positiveEndWorld,
  };
}

function isSimilarObject(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  if (source.pathKey === target.pathKey) {
    return false;
  }

  if (source.elongationRatio < 2.2 || target.elongationRatio < 2.2) {
    return false;
  }

  const sourceLength = source.axisLength;
  const targetLength = target.axisLength;

  const lengthRatio =
    Math.min(sourceLength, targetLength) / Math.max(sourceLength, targetLength);

  if (lengthRatio < 0.6) {
    return false;
  }

  const sourceThickness = source.crossSectionSize;
  const targetThickness = target.crossSectionSize;

  const thicknessRatio =
    Math.min(sourceThickness, targetThickness) /
    Math.max(sourceThickness, targetThickness);

  if (thicknessRatio < 0.45) {
    return false;
  }

  const sourceAxis = new THREE.Vector3(...source.principalAxisWorld);
  const targetAxis = new THREE.Vector3(...target.principalAxisWorld);
  const axisSimilarity = Math.abs(sourceAxis.dot(targetAxis));

  return axisSimilarity > 0.65;
}

export function buildObjectSummaries(
  scene: THREE.Object3D,
  selectedPathKeys: string[],
): AxialStretchObjectSummary[] {
  scene.updateMatrixWorld(true);

  const selectedSet = new Set(selectedPathKeys);
  const summariesByPathKey = new Map<string, AxialStretchObjectSummary>();

  scene.traverse((object) => {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string" || pathKey.length === 0) {
      return;
    }

    if (summariesByPathKey.has(pathKey)) {
      return;
    }

    const points = collectWorldPoints(object);

    if (points.length < 3) {
      return;
    }

    const aabb = new THREE.Box3().setFromPoints(points);

    if (aabb.isEmpty()) {
      return;
    }

    const aabbSize = new THREE.Vector3();
    const aabbCenter = new THREE.Vector3();

    aabb.getSize(aabbSize);
    aabb.getCenter(aabbCenter);

    const principalAxisWorld = computePrincipalAxis(points);
    const metrics = computeAxisMetrics(points, principalAxisWorld);

    summariesByPathKey.set(pathKey, {
      pathKey,
      name: object.name || null,
      selectedByLasso: selectedSet.has(pathKey),

      aabbSizeWorld: toTuple(aabbSize),
      aabbCenterWorld: toTuple(aabbCenter),

      principalAxisWorld: toTuple(principalAxisWorld),
      axisLength: metrics.axisLength,
      crossSectionSize: metrics.crossSectionSize,
      elongationRatio: metrics.elongationRatio,

      negativeEndWorld: toTuple(metrics.negativeEndWorld),
      positiveEndWorld: toTuple(metrics.positiveEndWorld),

      mateConnections: [],
      similarPathKeys: [],
    });
  });

  const summaries = Array.from(summariesByPathKey.values());

  for (const summary of summaries) {
    summary.similarPathKeys = summaries
      .filter((candidate) => isSimilarObject(summary, candidate))
      .map((candidate) => candidate.pathKey);
  }

  return summaries;
}