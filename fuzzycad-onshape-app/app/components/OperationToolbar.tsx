"use client";

import { useState, type ReactNode } from "react";
import styles from "../fuzzycad-home.module.css";
import type { OperationTool } from "../lib/operations/types";

type OperationToolbarProps = {
  activeTool: OperationTool;
  disabled?: boolean;
  onToolChange: (tool: OperationTool) => void;
};

type ToolItem = {
  id: OperationTool;
  label: string;
  title: string;
  icon: ReactNode;
  hidden?: boolean;
};

function SelectIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 6L23 17L17 18L20 26L16 27L13 19L9 24V6Z" />
    </svg>
  );
}

function LassoIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 17C5 10 12 5 20 7C28 9 28 19 20 22C13 25 6 23 8 17Z" />
      <path d="M19 22L24 28" />
    </svg>
  );
}

function SizeIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 5V27" />
      <path d="M11 10L16 5L21 10" />
      <path d="M11 22L16 27L21 22" />
      <path d="M7 24H25" />
      <path d="M7 8H25" />
    </svg>
  );
}

function ExtendIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 16H25" />
      <path d="M11 12L7 16L11 20" />
      <path d="M21 12L25 16L21 20" />
      <path d="M13 10L19 22" />
    </svg>
  );
}

function AngleIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 24L24 8" />
      <path d="M8 24H26" />
      <path d="M13 24C13 20 15 17 18 15" />
    </svg>
  );
}

function BendIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 10H16" />
      <path d="M16 10L26 20" />
      <path d="M16 6V14" strokeDasharray="2 2" />
      <path d="M21 10C21 13 20 15 18 16" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 5V27" />
      <path d="M5 16H27" />
      <path d="M12 9L16 5L20 9" />
      <path d="M12 23L16 27L20 23" />
      <path d="M9 12L5 16L9 20" />
      <path d="M23 12L27 16L23 20" />
    </svg>
  );
}

const tools: ToolItem[] = [
  {
    id: "select",
    label: "Select",
    title: "Select objects",
    icon: <SelectIcon />,
  },
  {
    id: "lasso",
    label: "Lasso",
    title: "Lasso multiple objects",
    icon: <LassoIcon />,
    hidden: true,
  },
  {
    id: "height",
    label: "Size",
    title: "Add size/height uncertainty mark",
    icon: <SizeIcon />,
  },
  {
    id: "extend",
    label: "Extend",
    title: "Stretch assembly height",
    icon: <SizeIcon />,
    hidden: true,
  },
];

/**
 * The Angle entry is a split button: hovering it reveals the two angle
 * modes — Rotate (two-part vertex + face flow) and Bend (single-part
 * crease flow).
 */
const angleModes: { id: OperationTool; label: string; title: string; icon: ReactNode }[] = [
  {
    id: "angle",
    label: "Rotate",
    title: "Rotate one part relative to another around a pivot vertex",
    icon: <AngleIcon />,
  },
  {
    id: "bend",
    label: "Bend",
    title: "Draw a crease line on one part and bend it",
    icon: <BendIcon />,
  },
];

export default function OperationToolbar({
  activeTool,
  disabled = false,
  onToolChange,
}: OperationToolbarProps) {
  const [angleMenuOpen, setAngleMenuOpen] = useState(false);

  const angleActive = activeTool === "angle" || activeTool === "bend";
  const activeAngleMode =
    angleModes.find((mode) => mode.id === activeTool) ?? angleModes[0];

  return (
    <div className={styles.operationToolbarWrap}>
      <div className={styles.operationToolbar} aria-label="FuzzyCAD tools">
        {tools
          .filter((tool) => !tool.hidden)
          .map((tool) => {
            const active = activeTool === tool.id;

            return (
              <button
                key={tool.id}
                type="button"
                title={tool.title}
                disabled={disabled}
                className={
                  active
                    ? `${styles.operationToolButton} ${styles.operationToolButtonActive}`
                    : styles.operationToolButton
                }
                onClick={() => {
                  onToolChange(tool.id);
                }}
              >
                <span className={styles.operationToolIcon}>{tool.icon}</span>
                <span className={styles.operationToolLabel}>{tool.label}</span>
              </button>
            );
          })}

        {/* Angle split button: hover reveals Rotate | Bend */}
        <div
          style={{ position: "relative", display: "inline-flex" }}
          onMouseEnter={() => setAngleMenuOpen(true)}
          onMouseLeave={() => setAngleMenuOpen(false)}
        >
          <button
            type="button"
            title="Angle tools — hover for Rotate / Bend"
            disabled={disabled}
            className={
              angleActive
                ? `${styles.operationToolButton} ${styles.operationToolButtonActive}`
                : styles.operationToolButton
            }
            onClick={() => {
              // Clicking the main button activates the last-used / default mode.
              onToolChange(angleActive ? activeAngleMode.id : "angle");
            }}
          >
            <span className={styles.operationToolIcon}>
              {activeAngleMode.icon}
            </span>
            <span className={styles.operationToolLabel}>
              {angleActive ? activeAngleMode.label : "Angle"}
            </span>
          </button>

          {angleMenuOpen && !disabled ? (
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                paddingBottom: 6,
                zIndex: 30,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  background: "rgba(255,255,255,0.97)",
                  border: "1px solid rgba(43,108,255,0.25)",
                  borderRadius: 10,
                  padding: 4,
                  boxShadow: "0 6px 18px rgba(15,23,42,0.16)",
                }}
              >
                {angleModes.map((mode) => {
                  const modeActive = activeTool === mode.id;

                  return (
                    <button
                      key={mode.id}
                      type="button"
                      title={mode.title}
                      className={
                        modeActive
                          ? `${styles.operationToolButton} ${styles.operationToolButtonActive}`
                          : styles.operationToolButton
                      }
                      onClick={() => {
                        onToolChange(mode.id);
                        setAngleMenuOpen(false);
                      }}
                    >
                      <span className={styles.operationToolIcon}>
                        {mode.icon}
                      </span>
                      <span className={styles.operationToolLabel}>
                        {mode.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}