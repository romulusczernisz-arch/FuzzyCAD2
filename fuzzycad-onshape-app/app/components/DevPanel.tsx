"use client";

import styles from "../fuzzycad-home.module.css";
import ApiUsagePanel from "./ApiUsagePanel";
import type { MeshGraphNode } from "./FuzzyCADGeometryViewer";

type DevActionOptions = {
  force?: boolean;
};

type DevAction = (options?: DevActionOptions) => void | Promise<void>;

type DevGraphStats = {
  matched: number;
  total: number;
  scale: number;
  clickedPathKey: string | null;
  linkedCount: number | null;
};

type DebugResult = {
  title: string;
  value: unknown | null;
};

type DevPanelProps = {
  connectHref: string;
  selectedAssemblyId: string;
  graphStats: DevGraphStats | null;
  meshGraph: MeshGraphNode[];
  debugResults: DebugResult[];
  allParams: [string, string][];
  onClose: () => void;
  onLoadElements: DevAction;
  onLoadRawAssembly: DevAction;
  onLoadSummary: DevAction;
  onBuildGraph: DevAction;
  onLoadGeometry: DevAction;
  onInspectZip: DevAction;
};

export default function DevPanel({
  connectHref,
  selectedAssemblyId,
  graphStats,
  meshGraph,
  debugResults,
  allParams,
  onClose,
  onLoadElements,
  onLoadRawAssembly,
  onLoadSummary,
  onBuildGraph,
  onLoadGeometry,
  onInspectZip,
}: DevPanelProps) {
  return (
    <div className={styles.devOverlay}>
      <button onClick={onClose} className={styles.devCloseButton}>
        Close
      </button>
      <ApiUsagePanel />
      <h2>Actions</h2>

      <div className={styles.devActions}>
        <a href={connectHref}>Connect Onshape</a>

        <button
          onClick={() => {
            void onLoadElements();
          }}
        >
          Load Elements
        </button>

        <button
          onClick={() => {
            void onLoadElements({ force: true });
          }}
        >
          Force Load Elements
        </button>

        <button
          onClick={() => {
            void onLoadRawAssembly();
          }}
          disabled={!selectedAssemblyId}
        >
          Raw Assembly
        </button>

        <button
          onClick={() => {
            void onLoadRawAssembly({ force: true });
          }}
          disabled={!selectedAssemblyId}
        >
          Force Raw Assembly
        </button>

        <button
          onClick={() => {
            void onLoadSummary();
          }}
          disabled={!selectedAssemblyId}
        >
          Summary
        </button>

        <button
          onClick={() => {
            void onLoadSummary({ force: true });
          }}
          disabled={!selectedAssemblyId}
        >
          Force Summary
        </button>

        <button
          onClick={() => {
            void onBuildGraph();
          }}
          disabled={!selectedAssemblyId}
        >
          Build Graph
        </button>

        <button
          onClick={() => {
            void onBuildGraph({ force: true });
          }}
          disabled={!selectedAssemblyId}
        >
          Force Build Graph
        </button>

        <button
          onClick={() => {
            void onLoadGeometry();
          }}
          disabled={!selectedAssemblyId}
        >
          Load Geometry
        </button>

        <button
          onClick={() => {
            void onLoadGeometry({ force: true });
          }}
          disabled={!selectedAssemblyId}
        >
          Force Load Geometry
        </button>

        <button
          onClick={() => {
            void onInspectZip();
          }}
          disabled={!selectedAssemblyId}
        >
          Inspect ZIP
        </button>

        <button
          onClick={() => {
            void onInspectZip({ force: true });
          }}
          disabled={!selectedAssemblyId}
        >
          Force Inspect ZIP
        </button>
      </div>

      {graphStats ? (
        <p className={styles.devStats}>
          Matched: {graphStats.matched}/{graphStats.total} · scale{" "}
          {graphStats.scale}
          {graphStats.clickedPathKey ? (
            <>
              {" "}
              · clicked {graphStats.clickedPathKey}
              {graphStats.linkedCount !== null ? (
                <> · linked {graphStats.linkedCount}</>
              ) : null}
            </>
          ) : null}
        </p>
      ) : null}

      {meshGraph.length > 0 ? (
        <p>
          Objects: {meshGraph.length}; Mesh:{" "}
          {meshGraph.filter((node) => node.isMesh).length}
        </p>
      ) : null}

      {debugResults.map(({ title, value }) =>
        value ? (
          <details key={title} className={styles.debugDetails}>
            <summary className={styles.debugSummary}>{title}</summary>

            <pre className={styles.debugPre}>
              {JSON.stringify(value, null, 2)}
            </pre>
          </details>
        ) : null,
      )}

      <details className={styles.debugDetails}>
        <summary className={styles.debugSummary}>All URL Parameters</summary>

        <table className={styles.paramsTable}>
          <tbody>
            {allParams.map(([key, value]) => (
              <tr key={key}>
                <td className={styles.paramsCell}>{key}</td>
                <td className={styles.paramsCell}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
