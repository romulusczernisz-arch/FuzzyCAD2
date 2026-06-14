import * as THREE from "three";

export type ScreenPoint = {
  x: number;
  y: number;
};

function pointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];

    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x <
        ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 1e-9) + pi.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function projectWorldPoint(
  point: THREE.Vector3,
  camera: THREE.Camera,
  rect: DOMRect,
): ScreenPoint | null {
  const projected = point.clone().project(camera);

  if (projected.z < -1 || projected.z > 1) {
    return null;
  }

  return {
    x: (projected.x * 0.5 + 0.5) * rect.width,
    y: (-projected.y * 0.5 + 0.5) * rect.height,
  };
}

function getBoxPoints(box: THREE.Box3): THREE.Vector3[] {
  const min = box.min;
  const max = box.max;
  const center = box.getCenter(new THREE.Vector3());

  return [
    center,
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

export function selectPathKeysByLasso(
  scene: THREE.Object3D,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  polygon: ScreenPoint[],
): string[] {
  if (polygon.length < 3) {
    return [];
  }

  const rect = canvas.getBoundingClientRect();
  const selected = new Set<string>();

  scene.updateMatrixWorld(true);

  scene.traverse((object) => {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string" || pathKey.length === 0) {
      return;
    }

    const box = new THREE.Box3().setFromObject(object);

    if (box.isEmpty()) {
      return;
    }

    const projectedPoints = getBoxPoints(box)
      .map((point) => projectWorldPoint(point, camera, rect))
      .filter((point): point is ScreenPoint => point !== null);

    const hit = projectedPoints.some((point) => pointInPolygon(point, polygon));

    if (hit) {
      selected.add(pathKey);
    }
  });

  return Array.from(selected);
}