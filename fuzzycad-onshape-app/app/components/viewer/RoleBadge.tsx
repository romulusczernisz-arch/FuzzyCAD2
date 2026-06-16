import { Html, Line } from "@react-three/drei";
import styles from "./RoleBadge.module.css";

export type RoleBadgeRole = "stretchTarget" | "moveWithEnd" | "fixedAnchor";

type Vec3Tuple = [number, number, number];

type RoleBadgeProps = {
  anchorPosition: Vec3Tuple;
  position: Vec3Tuple;
  role: RoleBadgeRole;
};

const ROLE_LABEL: Record<RoleBadgeRole, string> = {
  stretchTarget: "Stretch target",
  moveWithEnd: "Move with end",
  fixedAnchor: "Fixed anchor",
};

function RoleIcon({ role }: { role: RoleBadgeRole }) {
  if (role === "stretchTarget") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v16" />
        <path d="M8 8l4-4 4 4" />
        <path d="M8 16l4 4 4-4" />
      </svg>
    );
  }

  if (role === "moveWithEnd") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h14" />
        <path d="M14 7l5 5-5 5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="10" width="12" height="10" rx="2" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" />
    </svg>
  );
}

const ROLE_LINE_COLOR: Record<RoleBadgeRole, string> = {
  stretchTarget: "#0284c7",
  moveWithEnd: "#ea580c",
  fixedAnchor: "#7c3aed",
};

export default function RoleBadge({
  anchorPosition,
  position,
  role,
}: RoleBadgeProps) {
  return (
    <>
      <Line
        points={[anchorPosition, position]}
        color={ROLE_LINE_COLOR[role]}
        lineWidth={1}
        dashed
        dashSize={0.025}
        gapSize={0.018}
        transparent
        opacity={0.7}
      />

      <Html
        position={position}
        center
        distanceFactor={7}
        zIndexRange={[30, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          className={`${styles.badge} ${styles[role]}`}
          title={ROLE_LABEL[role]}
          aria-label={ROLE_LABEL[role]}
        >
          <RoleIcon role={role} />
        </div>
      </Html>
    </>
  );
}