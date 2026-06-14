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
  onAssemblyChange: (assemblyId: string) => void;
  onLoadAssembly: () => void;
  onSelectPathKey: (pathKey: string | null) => void;
  onToggleDev: () => void;
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
  onAssemblyChange,
  onLoadAssembly,
  onSelectPathKey,
  onToggleDev,
}: FuzzyCADSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>FuzzyCAD</div>

      {!connected ? (
        <a href={connectHref} className={styles.connectButton}>
          Connect to Onshape
        </a>
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