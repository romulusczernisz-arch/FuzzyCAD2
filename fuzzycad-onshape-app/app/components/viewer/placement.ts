import * as THREE from "three";

export type PartPlacement = {
  pathKey: string;
  partName: string | null;
  transform: number[];
};

export type PlacementReport = {
  groupCount: number;
  placementCount: number;
  placedByName: number;
  placedByOrder: number;
  groupNames: string[];
  placementNames: (string | null)[];
};

function sanitize(s: string | null | undefined): string {
  return (s || "")
    .replace(/\s*<\s*\d+\s*>\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function groupBaseKey(groupKey: string, baseSet: Set<string>): string | null {
  if (baseSet.has(groupKey)) {
    return groupKey;
  }

  let k = groupKey;

  for (;;) {
    const m = k.match(/^(.*)_\d+$/);

    if (!m) {
      break;
    }

    k = m[1];

    if (baseSet.has(k)) {
      return k;
    }
  }

  return null;
}

function isAncestor(ancestor: THREE.Object3D, node: THREE.Object3D): boolean {
  let parent = node.parent;

  while (parent) {
    if (parent === ancestor) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
}

function collectPartGroups(scene: THREE.Object3D): THREE.Object3D[] {
  const groups: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (object === scene || object instanceof THREE.Mesh) {
      return;
    }

    if (!object.name || object.name === "Scene") {
      return;
    }

    let hasMesh = false;

    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        hasMesh = true;
      }
    });

    if (hasMesh) {
      groups.push(object);
    }
  });

  return groups.filter(
    (group) =>
      !groups.some((other) => other !== group && isAncestor(other, group))
  );
}

function placeGroup(
  group: THREE.Object3D,
  transform: number[],
  sceneInverse: THREE.Matrix4
) {
  const occurrenceMatrix = new THREE.Matrix4();

  occurrenceMatrix.set(
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[4],
    transform[5],
    transform[6],
    transform[7],
    transform[8],
    transform[9],
    transform[10],
    transform[11],
    transform[12],
    transform[13],
    transform[14],
    transform[15]
  );

  const parent = group.parent ?? group;
  const parentRelativeMatrix = sceneInverse.clone().multiply(parent.matrixWorld);
  const localMatrix = parentRelativeMatrix.invert().multiply(occurrenceMatrix);

  localMatrix.decompose(group.position, group.quaternion, group.scale);
  group.matrixWorldNeedsUpdate = true;
}

export function applyPlacements(
  scene: THREE.Object3D,
  placements: PartPlacement[]
): PlacementReport {
  const report: PlacementReport = {
    groupCount: 0,
    placementCount: placements?.length ?? 0,
    placedByName: 0,
    placedByOrder: 0,
    groupNames: [],
    placementNames: (placements ?? []).map((placement) => placement.partName),
  };

  if (!placements || placements.length === 0) {
    return report;
  }

  scene.updateMatrixWorld(true);

  const groups = collectPartGroups(scene);
  report.groupCount = groups.length;
  report.groupNames = groups.map((group) => group.name);

  const byBase = new Map<string, { transform: number[]; pathKey: string }[]>();

  for (const placement of placements) {
    const key = sanitize(placement.partName);

    if (!key) {
      continue;
    }

    if (!byBase.has(key)) {
      byBase.set(key, []);
    }

    byBase.get(key)!.push({
      transform: placement.transform,
      pathKey: placement.pathKey,
    });
  }

  const baseSet = new Set(byBase.keys());
  const sceneInverse = scene.matrixWorld.clone().invert();
  const cursor = new Map<string, number>();
  const unmatchedGroups: THREE.Object3D[] = [];

  for (const group of groups) {
    const base = groupBaseKey(sanitize(group.name), baseSet);

    if (!base) {
      unmatchedGroups.push(group);
      continue;
    }

    const list = byBase.get(base)!;
    const index = cursor.get(base) ?? 0;

    if (index >= list.length) {
      unmatchedGroups.push(group);
      continue;
    }

    cursor.set(base, index + 1);
    placeGroup(group, list[index].transform, sceneInverse);
    group.userData.fuzzyPathKey = list[index].pathKey;
    report.placedByName++;
  }

  if (unmatchedGroups.length > 0) {
    const leftovers: { transform: number[]; pathKey: string }[] = [];

    for (const [base, list] of byBase) {
      const used = cursor.get(base) ?? 0;

      for (let index = used; index < list.length; index++) {
        leftovers.push(list[index]);
      }
    }

    for (
      let index = 0;
      index < unmatchedGroups.length && index < leftovers.length;
      index++
    ) {
      placeGroup(
        unmatchedGroups[index],
        leftovers[index].transform,
        sceneInverse
      );
      unmatchedGroups[index].userData.fuzzyPathKey = leftovers[index].pathKey;
      report.placedByOrder++;
    }
  }

  console.log(
    `[FuzzyCAD] placement: 按名字摆了 ${report.placedByName}/${report.groupCount}，按顺序兜底 ${report.placedByOrder}。组名: [${report.groupNames.join(", ")}]`
  );

  return report;
}