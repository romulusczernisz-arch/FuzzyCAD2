"use client";

import type { ReactNode } from "react";
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

function HeightIcon() {
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
    label: "Height",
    title: "Mark height uncertainty",
    icon: <HeightIcon />,
  },
  {
    id: "extend",
    label: "Extend",
    title: "Extend linkage length",
    icon: <ExtendIcon />,
  },
  {
    id: "angle",
    label: "Angle",
    title: "Adjust support arm angle",
    icon: <AngleIcon />,
  },
  {
    id: "move",
    label: "Move",
    title: "Move attachment on surface",
    icon: <MoveIcon />,
  },
];

export default function OperationToolbar({
  activeTool,
  disabled = false,
  onToolChange,
}: OperationToolbarProps) {
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
      </div>
    </div>
  );
}