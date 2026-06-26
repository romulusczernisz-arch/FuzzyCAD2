"use client";

import styles from "../fuzzycad-home.module.css";
import PartTree, { type TreeGroup } from "./PartTree";

type AssemblyElement = {
  id: string;
  name: string;
  type?: string;
  elementType?: string;
  dataType?: string;
};

type FuzzyCADSidebarProps = {
  connected: boolean;
  connectHref: string;
  assemblyElements: AssemblyElement[];
  selectedAssemblyId: string;
  busy: boolean;
  partTree: TreeGroup[];
  highlightedPathKey: string | null;
  dev: boolean;
  manipulationValue?: number;
  applyStatus?: "idle" | "applying" | "success" | "error";
  applyError?: string | null;
  onAssemblyChange: (assemblyId: string) => void;
  onLoadAssembly: () => void;
  onSelectPathKey: (pathKey: string | null) => void;
  onToggleDev: () => void;
  onApply?: () => void;
  onResetApply?: () => void;
};

export default function FuzzyCADSidebar({
  connected,
  connectHref,
  assemblyElements,
  selectedAssemblyId,
  busy,
  partTree,
  highlightedPathKey,
  dev,
  manipulationValue,
  applyStatus = "idle",
  applyError,
  onAssemblyChange,
  onLoadAssembly,
  onSelectPathKey,
  onToggleDev,
  onApply,
  onResetApply,
}: FuzzyCADSidebarProps) {
  const hasPendingChange =
    onApply !== undefined && Math.abs(manipulationValue ?? 0) > 1e-9;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>FuzzyCAD</div>

      {!connected ? (
        <a href={connectHref} className={styles.connectButton}>
          Connect to Onshape
        </a>
      ) : null}

      {hasPendingChange || applyStatus === "success" || applyStatus === "error" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, color: "#555", fontWeight: 600 }}>
            Height change:{" "}
            <span style={{ color: "#2b6cff" }}>
              {(manipulationValue ?? 0) >= 0 ? "+" : ""}
              {((manipulationValue ?? 0) * 1000).toFixed(1)} mm
            </span>
          </div>

          {applyStatus === "success" ? (
            <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>
              ✓ Applied to Onshape
            </div>
          ) : applyStatus === "error" ? (
            <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 700 }} title={applyError ?? undefined}>
              ✗ {applyError ?? "Apply failed"}
            </div>
          ) : (
            <button
              className={styles.primaryButton}
              disabled={applyStatus === "applying"}
              onClick={onApply}
            >
              {applyStatus === "applying" ? "Applying…" : "Apply to Onshape"}
            </button>
          )}

          <button className={styles.secondaryButton} onClick={onResetApply}>
            Reset
          </button>
        </div>
      ) : null}

      {assemblyElements.length > 0 ? (
        <>
          <label className={styles.assemblyLabel}>Assembly</label>

          <select
            value={selectedAssemblyId}
            onChange={(event) => {
              onAssemblyChange(event.target.value);
            }}
            className={styles.assemblySelect}
          >
            {assemblyElements.map((assembly) => (
              <option key={assembly.id} value={assembly.id}>
                {assembly.name}
              </option>
            ))}
          </select>

          <button
            onClick={onLoadAssembly}
            disabled={!selectedAssemblyId || busy}
            className={styles.primaryButton}
          >
            {busy ? "Loading..." : "Loading assembly"}
          </button>
        </>
      ) : (
        <p className={styles.emptyMessage}>
          {connected ? "Assembly not found." : "Please connect Onshape first."}
        </p>
      )}

      <PartTree
        groups={partTree}
        selectedPathKey={highlightedPathKey}
        onSelectPathKey={onSelectPathKey}
      />

      <button onClick={onToggleDev} className={styles.secondaryButton}>
        {dev ? "Hide Debug Panel" : "Debug Panel"}
      </button>
    </aside>
  );
}