import type { OperationTool } from "../lib/operations/types";
import styles from "./OperationPreviewPanel.module.css";

export type OperationAxis = "x" | "y" | "z";
export type OperationDirection = "positive" | "negative" | "both";

type RoleCounts = {
  stretchTarget?: number;
  moveWithEnd?: number;
  fixedAnchor?: number;
  excluded?: number;
};

type OperationPreviewPanelProps = {
  operation: OperationTool;
  title: string;
  description?: string;
  axis?: OperationAxis;
  direction?: OperationDirection;
  showAxisControls?: boolean;
  roleCounts?: RoleCounts;
  confirmLabel?: string;
  cancelLabel?: string;
  onAxisChange?: (axis: OperationAxis) => void;
  onDirectionChange?: (direction: OperationDirection) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const AXES: OperationAxis[] = ["x", "y", "z"];

const DIRECTIONS: {
  value: OperationDirection;
  label: string;
}[] = [
  { value: "positive", label: "+" },
  { value: "negative", label: "−" },
  { value: "both", label: "Both" },
];

export default function OperationPreviewPanel({
  operation,
  title,
  description,
  axis = "y",
  direction = "positive",
  showAxisControls = false,
  roleCounts,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onAxisChange,
  onDirectionChange,
  onConfirm,
  onCancel,
}: OperationPreviewPanelProps) {
  return (
    <section className={styles.panel} aria-label={`${operation} preview`}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Operation preview</div>
          <h2 className={styles.title}>{title}</h2>
        </div>
      </div>

      {description ? <p className={styles.description}>{description}</p> : null}

      {showAxisControls ? (
        <div className={styles.configBlock}>
          <div className={styles.configRow}>
            <span className={styles.configLabel}>Axis</span>
            <div className={styles.segmented}>
              {AXES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={
                    item === axis
                      ? `${styles.segmentButton} ${styles.segmentButtonActive}`
                      : styles.segmentButton
                  }
                  onClick={() => onAxisChange?.(item)}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.configRow}>
            <span className={styles.configLabel}>Direction</span>
            <div className={styles.segmented}>
              {DIRECTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={
                    item.value === direction
                      ? `${styles.segmentButton} ${styles.segmentButtonActive}`
                      : styles.segmentButton
                  }
                  onClick={() => onDirectionChange?.(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {roleCounts ? (
        <div className={styles.roleGrid}>
          <div className={styles.roleItem}>
            <span className={styles.roleIconStretch}>↕</span>
            <span className={styles.roleLabel}>Stretch</span>
            <strong>{roleCounts.stretchTarget ?? 0}</strong>
          </div>

          <div className={styles.roleItem}>
            <span className={styles.roleIconFollow}>→</span>
            <span className={styles.roleLabel}>Follow</span>
            <strong>{roleCounts.moveWithEnd ?? 0}</strong>
          </div>

          <div className={styles.roleItem}>
            <span className={styles.roleIconFixed}>Lock</span>
            <span className={styles.roleLabel}>Fixed</span>
            <strong>{roleCounts.fixedAnchor ?? 0}</strong>
          </div>

          <div className={styles.roleItem}>
            <span className={styles.roleIconExcluded}>×</span>
            <span className={styles.roleLabel}>Excluded</span>
            <strong>{roleCounts.excluded ?? 0}</strong>
          </div>
        </div>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </section>
  );
}