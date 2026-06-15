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

function groupHeight(group: CompactAxialStretchGroup) {
  return Math.max(group.yRange[1] - group.yRange[0], 1e-6);
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
  // heightDirection is [0, 1, 0], so this is |axis.y|.
  return Math.abs(group.avgAxis[1]);
}

function selectPrimaryStretchGroups(groups: CompactAxialStretchGroup[]) {
  const selectedElongatedGroups = groups.filter(
    (group) => group.selectedCount > 0 && isStrongElongated(group),
  );

  if (selectedElongatedGroups.length === 0) {
    return [];
  }

  const scored = selectedElongatedGroups.map((group) => {
    let score = 0;

    // Strong geometric signal: long/thin objects are better stretch candidates.
    score += Math.min(group.avgElongation / 8, 4);

    // Repeated members are more likely to be structural supports.
    if (isRepeated(group)) {
      score += 2;
    }

    // Height operation prefers objects whose axes contribute to height.
    score += verticalAxisComponent(group) * 2;

    // For height editing, lower elongated selected groups are usually
    // better candidates than upper structural members.
    score += -groupCenterY(group) * 2;

    // Very short elongated objects may be small rods/details, not main supports.
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

  // Keep only groups very close to the best score.
  // This avoids selecting all elongated members.
  return scored
    .filter((item) => item.score >= best.score - 0.75)
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
            "Selected repeated elongated group with strong height-axis contribution; use object-axis stretch.",
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
            "Selected elongated group, but not the primary height-changing segment under the current selection.",
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
      "Names are only labels in the compact context; this planner uses shape, repetition, axis direction, selection, and vertical position.",
    ],
  };
}