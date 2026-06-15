import type {
  CompactAxialStretchContext,
  CompactAxialStretchGroup,
} from "./compactAxialStretchContext";

export type CompactAxialStretchRole =
  | "stretchTarget"
  | "moveWithEnd"
  | "fixedAnchor"
  | "excluded";

export type CompactAxialStretchPlanRole = {
  targetId: string;
  targetType: "group" | "object";
  role: CompactAxialStretchRole;
  reason: string;
};

export type CompactAxialStretchPlan = {
  operation: "height";
  roles: CompactAxialStretchPlanRole[];
  notes: string[];
};

function shortReason(text: string) {
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function groupCenterY(group: CompactAxialStretchGroup) {
  return (group.yRange[0] + group.yRange[1]) / 2;
}

function isRepeated(group: CompactAxialStretchGroup) {
  return group.count >= 2 || group.selectedCount >= 2;
}

function isStrongElongated(group: CompactAxialStretchGroup) {
  return group.shape === "elongated" && group.avgElongation >= 4;
}

function isCompact(group: CompactAxialStretchGroup) {
  return group.shape === "compact" || group.avgElongation < 2.2;
}

function verticalAxisComponent(group: CompactAxialStretchGroup) {
  return Math.abs(group.avgAxis[1]);
}

function selectPrimaryStretchGroups(groups: CompactAxialStretchGroup[]) {
  const selectedElongatedGroups = groups.filter(
    (group) => group.selectedCount > 0 && isStrongElongated(group),
  );

  if (selectedElongatedGroups.length === 0) {
    return [];
  }

  const centerYs = selectedElongatedGroups.map(groupCenterY);
  const centerYMin = Math.min(...centerYs);
  const centerYMax = Math.max(...centerYs);
  const centerYSpan = Math.max(centerYMax - centerYMin, 1e-6);

  const scored = selectedElongatedGroups.map((group) => {
    let score = 0;

    // Long/thin geometry is the strongest stretch signal.
    score += Math.min(group.avgElongation / 8, 4);

    // Repeated selected members are more likely to be structural supports.
    if (isRepeated(group)) {
      score += 2;
    } else {
      score -= 1;
    }

    // Height operation prefers members whose own axis contributes to height.
    score += verticalAxisComponent(group) * 2;

    // For height editing, prefer the lower selected elongated band.
    // This avoids stretching both upper and lower structural segments.
    score += -groupCenterY(group) * 3;

    // Very short elongated parts are often small rods/details.
    if (group.avgLength < 0.15) {
      score -= 3;
    }

    return { group, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (!best) {
    return [];
  }

  const bestCenterY = groupCenterY(best.group);

  // Keep only groups in the same lower vertical band as the best group.
  // This still allows multiple repeated lower groups, but prevents selecting
  // upper elongated members at the same time.
  const sameBandTolerance = Math.max(0.04, centerYSpan * 0.18);

  return scored
    .filter((item) => {
      const centerY = groupCenterY(item.group);

      return (
        item.score >= best.score - 0.5 &&
        centerY <= bestCenterY + sameBandTolerance
      );
    })
    .map((item) => item.group);
}

function classifyCompactGroupRelativeToStretch(
  group: CompactAxialStretchGroup,
  stretchYMin: number,
  stretchYMax: number,
): CompactAxialStretchPlanRole {
  const centerY = groupCenterY(group);
  const stretchHeight = Math.max(stretchYMax - stretchYMin, 1e-6);

  const lowerBandMax = stretchYMin + stretchHeight * 0.22;
  const upperBandMin = stretchYMax - stretchHeight * 0.22;

  if (centerY <= lowerBandMax) {
    return {
      targetId: group.id,
      targetType: "group",
      role: "moveWithEnd",
      reason: shortReason(
        "Compact selected group near the lower end of the stretch region; should move with the changing end rather than stretch.",
      ),
    };
  }

  if (centerY >= upperBandMin) {
    return {
      targetId: group.id,
      targetType: "group",
      role: "fixedAnchor",
      reason: shortReason(
        "Compact selected group near the upper end of the stretch region; likely an anchor or connector that should stay fixed.",
      ),
    };
  }

  return {
    targetId: group.id,
    targetType: "group",
    role: "fixedAnchor",
    reason: shortReason(
      "Compact selected group within the stretch region; safer to preserve it as a connector rather than stretch it.",
    ),
  };
}

export function inferCompactAxialStretchPlan(
  context: CompactAxialStretchContext,
): CompactAxialStretchPlan {
  const groups = context.aiPayload.groups;
  const selectedGroups = groups.filter((group) => group.selectedCount > 0);

  if (selectedGroups.length === 0) {
    return {
      operation: "height",
      roles: [],
      notes: ["No selected groups. Use Lasso first, then click Height."],
    };
  }

  const primaryStretchGroups = selectPrimaryStretchGroups(groups);
  const primaryStretchIds = new Set(
    primaryStretchGroups.map((group) => group.id),
  );

  const stretchYMin =
    primaryStretchGroups.length > 0
      ? Math.min(...primaryStretchGroups.map((group) => group.yRange[0]))
      : Math.min(...selectedGroups.map((group) => group.yRange[0]));

  const stretchYMax =
    primaryStretchGroups.length > 0
      ? Math.max(...primaryStretchGroups.map((group) => group.yRange[1]))
      : Math.max(...selectedGroups.map((group) => group.yRange[1]));

  const roles: CompactAxialStretchPlanRole[] = groups
    .filter((group) => group.selectedCount > 0)
    .map((group) => {
      if (primaryStretchIds.has(group.id)) {
        return {
          targetId: group.id,
          targetType: "group",
          role: "stretchTarget",
          reason: shortReason(
            "Selected repeated elongated group in the primary lower height-changing band; use object-axis stretch.",
          ),
        };
      }

      if (isCompact(group)) {
        return classifyCompactGroupRelativeToStretch(
          group,
          stretchYMin,
          stretchYMax,
        );
      }

      if (isStrongElongated(group)) {
        return {
          targetId: group.id,
          targetType: "group",
          role: "excluded",
          reason: shortReason(
            "Selected elongated group, but outside the primary height-changing band for this operation.",
          ),
        };
      }

      return {
        targetId: group.id,
        targetType: "group",
        role: "excluded",
        reason: shortReason(
          "Selected group is not a clear stretch target or endpoint/anchor component.",
        ),
      };
    });

  return {
    operation: "height",
    roles,
    notes: [
      "This is a geometry-based local draft, not an AI result.",
      "Names are only display labels. The planner uses shape, repetition, axis direction, selection, and vertical position.",
    ],
  };
}