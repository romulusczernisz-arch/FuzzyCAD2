/**
 * Computes the Onshape occurrence transform updates needed to apply a height
 * manipulation to the actual document.
 *
 * Coordinate frame notes
 * ─────────────────────
 * The Three.js scene is rotated by -π/2 around the X axis
 * (`scene.rotation.x = -Math.PI / 2` in FuzzyCADGeometryViewer).
 *
 * In `placeGroup` (placement.ts), Onshape's occurrence transform is used
 * directly as the Three.js group's local matrix inside the rotated scene.
 * This means:
 *
 *   scene.position = R_x(-π/2) * group.localPosition
 *
 * Where the group's localPosition equals the Onshape transform's translation
 * (t[3], t[7], t[11]) for root-level parts.  So:
 *
 *   Three.js world_x = Onshape X   (= t[3])
 *   Three.js world_y = Onshape Z   (= t[11], Z-up → Y-up)
 *   Three.js world_z = -Onshape Y  (= -t[7])
 *
 * Inverse (Three.js world → Onshape):
 *   Onshape X = world_x
 *   Onshape Y = -world_z
 *   Onshape Z = world_y
 *
 * So a movement delta of (dx, dy, dz) in Three.js world space becomes
 * (dx, -dz, dy) in Onshape world space.
 *
 * We use isRelative: false (absolute transforms) to avoid any ambiguity about
 * how Onshape applies relative transforms.  We take the current occurrence
 * transform from the placements array and add the delta to the translation
 * components (indices 3, 7, 11 in the 16-element row-major matrix).
 */

import type { AxialStretchObjectSummary } from "./axialStretchTypes";
import type { OccurrenceUpdate } from "../onshapeClient";
import type { PartPlacement } from "../../components/FuzzyCADGeometryViewer";

type Vec3 = { x: number; y: number; z: number };

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v: Vec3): Vec3 {
  const l = Math.max(length(v), 1e-9);

  return scale(v, 1 / l);
}

function distSq(a: Vec3, b: Vec3): number {
  const d = sub(a, b);

  return d.x * d.x + d.y * d.y + d.z * d.z;
}

/** Convert a delta in Three.js world space to Onshape world space. */
function toOnshapeDelta(delta: Vec3): Vec3 {
  // Three.js world (dx, dy, dz) → Onshape (dx, -dz, dy)
  return { x: delta.x, y: -delta.z, z: delta.y };
}

/**
 * Build a new absolute 16-element row-major transform by adding an Onshape-
 * space translation delta to an existing transform.
 *
 * The Onshape transform is row-major, with translation at indices 3, 7, 11.
 */
function applyDeltaToTransform(
  currentTransform: number[],
  onshapeDelta: Vec3
): number[] {
  const t = [...currentTransform];

  t[3] = (t[3] ?? 0) + onshapeDelta.x;
  t[7] = (t[7] ?? 0) + onshapeDelta.y;
  t[11] = (t[11] ?? 0) + onshapeDelta.z;

  return t;
}

/** Identity transform with a translation. */
function identityWithTranslation(onshapeDelta: Vec3): number[] {
  // prettier-ignore
  return [
    1, 0, 0, onshapeDelta.x,
    0, 1, 0, onshapeDelta.y,
    0, 0, 1, onshapeDelta.z,
    0, 0, 0, 1,
  ];
}

type StretchAxisInfo = {
  pathKey: string;
  /** World-space translation delta for this object (Three.js space). */
  movingDeltaThree: Vec3;
  /** Lower (moving) end in Three.js world space — used to assign followers. */
  lowerEndWorld: Vec3;
};

function computeStretchAxisInfo(
  pathKey: string,
  summaries: AxialStretchObjectSummary[],
  manipulationValue: number
): StretchAxisInfo | null {
  const s = summaries.find((item) => item.pathKey === pathKey);

  if (!s) {
    return null;
  }

  const neg: Vec3 = {
    x: s.negativeEndWorld[0],
    y: s.negativeEndWorld[1],
    z: s.negativeEndWorld[2],
  };
  const pos: Vec3 = {
    x: s.positiveEndWorld[0],
    y: s.positiveEndWorld[1],
    z: s.positiveEndWorld[2],
  };

  // "Upper" = higher Three.js Y (which maps to Onshape Z, i.e. the up axis).
  const upperEnd = neg.y >= pos.y ? neg : pos;
  const lowerEnd = neg.y < pos.y ? neg : pos;

  const axisDir = normalize(sub(lowerEnd, upperEnd));

  // Same formula as getMovingDeltaForTarget in axialStretchPreview.ts.
  const yContrib = Math.max(Math.abs(axisDir.y), 0.08);
  const axialDelta = manipulationValue / yContrib;
  const movingDeltaThree = scale(axisDir, axialDelta);

  return { pathKey, movingDeltaThree, lowerEndWorld: lowerEnd };
}

function nearestStretchTarget(
  followerCenter: Vec3,
  targets: StretchAxisInfo[]
): StretchAxisInfo {
  let best = targets[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const t of targets) {
    const d = distSq(followerCenter, t.lowerEndWorld);

    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }

  return best;
}

export type HeightApplyPlan = {
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
};

/**
 * Given the confirmed role plan, object summaries, manipulation value, and
 * current placements (with Onshape transforms), returns the list of absolute
 * occurrence transform updates to POST to Onshape.
 *
 * Uses isRelative: false (absolute) — caller must include this in the request.
 * Both stretch targets and followers are translated as rigid bodies.
 */
export function computeOccurrenceUpdates(
  plan: HeightApplyPlan,
  summaries: AxialStretchObjectSummary[],
  manipulationValue: number,
  placements: PartPlacement[]
): OccurrenceUpdate[] {
  if (Math.abs(manipulationValue) < 1e-9) {
    return [];
  }

  const placementByPathKey = new Map(
    placements.map((p) => [p.pathKey, p])
  );

  // Compute axis info for each stretch target.
  const stretchTargets = plan.stretchTargetPathKeys
    .map((pk) => computeStretchAxisInfo(pk, summaries, manipulationValue))
    .filter((info): info is StretchAxisInfo => info !== null);

  if (stretchTargets.length === 0) {
    return [];
  }

  const updates: OccurrenceUpdate[] = [];

  function makeUpdate(pathKey: string, movingDeltaThree: Vec3): OccurrenceUpdate {
    const onshapeDelta = toOnshapeDelta(movingDeltaThree);
    const placement = placementByPathKey.get(pathKey);
    const newTransform =
      placement && placement.transform.length === 16
        ? applyDeltaToTransform(placement.transform, onshapeDelta)
        : identityWithTranslation(onshapeDelta);

    return {
      path: pathKey.split("/"),
      transform: newTransform,
    };
  }

  // Stretch targets: translate the sliding occurrence in Onshape.
  for (const t of stretchTargets) {
    updates.push(makeUpdate(t.pathKey, t.movingDeltaThree));
  }

  // Followers: find their nearest stretch target and apply the same delta.
  for (const followerPathKey of plan.moveWithEndPathKeys) {
    const followerSummary = summaries.find((s) => s.pathKey === followerPathKey);
    const followerCenter: Vec3 = followerSummary
      ? {
          x: followerSummary.aabbCenterWorld[0],
          y: followerSummary.aabbCenterWorld[1],
          z: followerSummary.aabbCenterWorld[2],
        }
      : stretchTargets[0].lowerEndWorld;

    const nearest = nearestStretchTarget(followerCenter, stretchTargets);

    updates.push(makeUpdate(followerPathKey, nearest.movingDeltaThree));
  }

  return updates;
}
