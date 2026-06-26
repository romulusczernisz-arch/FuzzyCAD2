import type { OperationTool } from "../lib/operations/types";
import type {
  AxisConfidenceMap,
  ConfidenceAxis,
  ConfidenceLevel,
} from "../lib/uncertainty/types";
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
  showConfidenceControls?: boolean;
  axisConfidence?: AxisConfidenceMap;
  suggestedObjects?: string[];
  roleCounts?: RoleCounts;
  confirmLabel?: string;
  secondaryConfirmLabel?: string;
  cancelLabel?: string;
  onAxisChange?: (axis: OperationAxis) => void;
  onDirectionChange?: (direction: OperationDirection) => void;
  onConfidenceChange?: (
    axis: ConfidenceAxis,
    confidence: ConfidenceLevel,
  ) => void;
  onConfirm: () => void;
  onSecondaryConfirm?: () => void;
  onCancel: () => void;
};

const AXES: OperationAxis[] = ["x", "y", "z"];

const CONFIDENCE_AXES: ConfidenceAxis[] = ["x", "y", "z"];

const CONFIDENCE_LEVELS: {
  value: ConfidenceLevel;
  label: string;
}[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

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
  showConfidenceControls = false,
  axisConfidence,
  suggestedObjects,
  roleCounts,
  confirmLabel = "Confirm",
  secondaryConfirmLabel,
  cancelLabel = "Cancel",
  onAxisChange,
  onDirectionChange,
  onConfidenceChange,
  onConfirm,
  onSecondaryConfirm,
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

      {suggestedObjects && suggestedObjects.length > 0 ? (
        <div className={styles.suggestionList}>
          <div className={styles.configLabel}>Detected related objects</div>
          {suggestedObjects.map((item) => (
            <div key={item} className={styles.suggestionItem}>
              {item}
            </div>
          ))}
        </div>
      ) : null}

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

      {showConfidenceControls && axisConfidence ? (
        <div className={styles.confidenceGrid}>
          <div className={styles.configLabel}>Axis confidence</div>

          {CONFIDENCE_AXES.map((confidenceAxis) => (
            <div key={confidenceAxis} className={styles.confidenceRow}>
              <span className={styles.confidenceLabel}>
                {confidenceAxis.toUpperCase()}
              </span>

              <div className={styles.segmented}>
                {CONFIDENCE_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    className={
                      axisConfidence[confidenceAxis] === level.value
                        ? `${styles.segmentButton} ${styles.segmentButtonActive}`
                        : styles.segmentButton
                    }
                    onClick={() =>
                      onConfidenceChange?.(confidenceAxis, level.value)
                    }
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
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

        {secondaryConfirmLabel && onSecondaryConfirm ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onSecondaryConfirm}
          >
            {secondaryConfirmLabel}
          </button>
        ) : null}

        <button type="button" className={styles.secondaryButton} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </section>
  );
}