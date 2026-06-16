import { Html } from "@react-three/drei";
import styles from "./RoleBadge.module.css";

export type RoleBadgeRole = "stretchTarget" | "moveWithEnd" | "fixedAnchor";

type RoleBadgeProps = {
  position: [number, number, number];
  role: RoleBadgeRole;
};

const ROLE_UI: Record<
  RoleBadgeRole,
  {
    icon: string;
    label: string;
  }
> = {
  stretchTarget: {
    icon: "↕",
    label: "Stretch",
  },
  moveWithEnd: {
    icon: "⇢",
    label: "Follow",
  },
  fixedAnchor: {
    icon: "🔒",
    label: "Fixed",
  },
};

export default function RoleBadge({ position, role }: RoleBadgeProps) {
  const ui = ROLE_UI[role];

  return (
    <Html
      position={position}
      center
      distanceFactor={8}
      zIndexRange={[30, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div className={styles.badge}>
        <span className={styles.icon}>{ui.icon}</span>
        <span className={styles.label}>{ui.label}</span>
      </div>
    </Html>
  );
}