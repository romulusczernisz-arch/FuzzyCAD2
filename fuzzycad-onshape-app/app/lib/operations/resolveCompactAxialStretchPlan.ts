import type {
  CompactAxialStretchContext,
  CompactAxialStretchGroup,
} from "./compactAxialStretchContext";
import type {
  CompactAxialStretchPlan,
  CompactAxialStretchPlanRole,
  CompactAxialStretchRole,
} from "./inferCompactAxialStretchPlan";

export type ResolvedAxialStretchPlanRole = {
  targetId: string;
  targetType: "group" | "object";
  role: CompactAxialStretchRole;
  objectIds: string[];
  pathKeys: string[];
  reason: string;
};

export type ResolvedAxialStretchPlan = {
  operation: "height";
  roles: ResolvedAxialStretchPlanRole[];
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
  fixedAnchorPathKeys: string[];
  excludedPathKeys: string[];
  editablePathKeys: string[];
  notes: string[];
};

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function findGroup(
  context: CompactAxialStretchContext,
  groupId: string,
): CompactAxialStretchGroup | null {
  return (
    context.aiPayload.groups.find((group) => group.id === groupId) ?? null
  );
}

function resolveObjectIdsForRole(
  role: CompactAxialStretchPlanRole,
  context: CompactAxialStretchContext,
) {
  if (role.targetType === "object") {
    return [role.targetId];
  }

  const group = findGroup(context, role.targetId);

  if (!group) {
    return [];
  }

  return group.objectIds;
}

function resolvePathKeysForObjectIds(
  objectIds: string[],
  context: CompactAxialStretchContext,
) {
  return unique(
    objectIds
      .map((objectId) => context.aliasMap[objectId])
      .filter((pathKey): pathKey is string => Boolean(pathKey)),
  );
}

function collectPathKeys(
  roles: ResolvedAxialStretchPlanRole[],
  roleName: CompactAxialStretchRole,
) {
  return unique(
    roles
      .filter((role) => role.role === roleName)
      .flatMap((role) => role.pathKeys),
  );
}

export function resolveCompactAxialStretchPlan(
  plan: CompactAxialStretchPlan,
  context: CompactAxialStretchContext,
): ResolvedAxialStretchPlan {
  const roles: ResolvedAxialStretchPlanRole[] = plan.roles.map((role) => {
    const objectIds = resolveObjectIdsForRole(role, context);
    const pathKeys = resolvePathKeysForObjectIds(objectIds, context);

    return {
      targetId: role.targetId,
      targetType: role.targetType,
      role: role.role,
      objectIds,
      pathKeys,
      reason: role.reason,
    };
  });

  const stretchTargetPathKeys = collectPathKeys(roles, "stretchTarget");
  const moveWithEndPathKeys = collectPathKeys(roles, "moveWithEnd");
  const fixedAnchorPathKeys = collectPathKeys(roles, "fixedAnchor");
  const excludedPathKeys = collectPathKeys(roles, "excluded");

  return {
    operation: "height",
    roles,
    stretchTargetPathKeys,
    moveWithEndPathKeys,
    fixedAnchorPathKeys,
    excludedPathKeys,
    editablePathKeys: unique([
      ...stretchTargetPathKeys,
      ...moveWithEndPathKeys,
    ]),
    notes: plan.notes,
  };
}