"use client";

import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Bounds, Html, OrbitControls, useGLTF } from "@react-three/drei";
import RoleBadge, { type RoleBadgeRole } from "./viewer/RoleBadge";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import styles from "./FuzzyCADGeometryViewer.module.css";
import { buildMeshGraph, type MeshGraphNode } from "./viewer/meshGraph";
import { findFuzzyPathKey } from "./viewer/selection";
import { applyPlacements, type PartPlacement } from "./viewer/placement";
import { applyPathHighlight } from "./viewer/highlight";
import { prepareRenderableMeshes } from "./viewer/materials";
import type { OperationTool } from "../lib/operations/types";
import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  ConfidenceAxis,
  ConfidenceDirection,
  ConfidenceLevel,
} from "../lib/uncertainty/types";
import {
  applyFuzzyConfidence,
  type ConfidenceAxisFrame,
  type FuzzyConfidenceAnnotation,
} from "./viewer/fuzzyBlur";

import LassoOverlay from "./viewer/LassoOverlay";
import {
  selectPathKeysByLasso,
  type ScreenPoint,
} from "./viewer/lassoObjectSelection";
import { buildObjectSummaries } from "./viewer/objectSummary";
import type { AxialStretchObjectSummary } from "../lib/operations/axialStretchTypes";
import {
  findObjectsByPathKeys,
  findTopLevelObjectsByPathKeys,
  projectToScreen,
  rotateObjectsAroundWorldAxis,
  translateObjectsWorld,
} from "./viewer/manipulation";
import {
  findMateConnectedParts,
  type MateGraphEdge,
} from "../lib/fuzzycad/mateGraph";
import SizingHandle from "./viewer/SizingHandle";
import AngleHandle from "./viewer/AngleHandle";
import {
  createAxialStretchPreviewSession,
  disposeAxialStretchPreviewSession,
  getAxialStretchPreviewHandle,
  updateAxialStretchPreviewSession,
  type AxialStretchPreviewSession,
  type AxialStretchRolePlan,
} from "./viewer/axialStretchPreview";

export type { MeshGraphNode } from "./viewer/meshGraph";
export type { PartPlacement, PlacementReport } from "./viewer/placement";
export type { AxialStretchObjectSummary } from "../lib/operations/axialStretchTypes";

export type RolePreviewPlan = {
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
  fixedAnchorPathKeys: string[];
  excludedPathKeys: string[];
};

export type FuzzyConfidenceEditor = {
  pathKey: string;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  onConfidenceChange: (
    axis: ConfidenceAxis,
    confidence: ConfidenceLevel,
  ) => void;
  onDirectionChange: (
    axis: ConfidenceAxis,
    direction: ConfidenceDirection,
  ) => void;
  canRemove?: boolean;
  onRemove?: () => void;
  onApply: () => void;
  onCancel: () => void;
};

type FuzzyCADGeometryViewerProps = {
  gltfUrl: string | null;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  activeTool?: OperationTool;
  confidenceAnnotations?: FuzzyConfidenceAnnotation[];
  confidenceEditor?: FuzzyConfidenceEditor | null;
  /** Path keys the active sizing/angle handle should act on. */
  activePathKeys?: string[];
  /** Current value of the active manipulation (world units for height/extend, degrees for angle). */
  manipulationValue?: number;
  rolePreviewPlan?: RolePreviewPlan | null;
  enableManipulationHandles?: boolean;
  confirmedHeightPlan?: AxialStretchRolePlan | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onObjectSummaries?: (summaries: AxialStretchObjectSummary[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
  onObjectLassoSelection?: (pathKeys: string[]) => void;
  onManipulationChange?: (value: number) => void;
  /**
   * Externally-controlled target angle for the angle tool, in degrees.
   * When the user edits θ in the sidebar panel this flows back into the
   * viewer so the arc + live rotation preview stay in sync.
   */
  angleTargetDeg?: number | null;
  /** Mate edges used to find the rigid group that rotates with part 2. */
  angleMateEdges?: MateGraphEdge[];
  /** Increment to force the angle tool to clear its selection + preview. */
  angleResetNonce?: number;
  onAngleSelection?: (data: {
    part1PathKey: string;
    part2PathKey: string;
    /** Target angle (deg) — starts at measuredAngleDeg until edited. */
    angleDeg: number;
    /** Angle between the two selected face normals as clicked (deg). */
    measuredAngleDeg: number;
    /** Face normals and pivot in Three.js viewer world space (scene.rotation.x = -π/2 applied). */
    face1Normal?: [number, number, number];
    face2Normal?: [number, number, number];
    /** Snapped pivot vertex (viewer world space). */
    pivot?: [number, number, number];
  }) => void;
};

type HandleConfig =
  | {
      kind: "axial";
      baseWorld: THREE.Vector3;
      axisWorld: THREE.Vector3;
      length: number;
      objects: THREE.Object3D[];
    }
  | {
      kind: "heightStretch";
      baseWorld: THREE.Vector3;
      axisWorld: THREE.Vector3;
      length: number;
      session: AxialStretchPreviewSession;
    }
  | {
      kind: "angle";
      pivotWorld: THREE.Vector3;
      objects: THREE.Object3D[];
    }
  | null;

function midpoint(a: [number, number, number], b: [number, number, number]) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as [
    number,
    number,
    number,
  ];
}

function getLowerEnd(summary: AxialStretchObjectSummary) {
  return summary.negativeEndWorld[1] <= summary.positiveEndWorld[1]
    ? summary.negativeEndWorld
    : summary.positiveEndWorld;
}

function getUpperEnd(summary: AxialStretchObjectSummary) {
  return summary.negativeEndWorld[1] >= summary.positiveEndWorld[1]
    ? summary.negativeEndWorld
    : summary.positiveEndWorld;
}

function pathKeyOffsetSign(pathKey: string) {
  let hash = 0;

  for (let index = 0; index < pathKey.length; index += 1) {
    hash = (hash * 31 + pathKey.charCodeAt(index)) | 0;
  }

  return hash % 2 === 0 ? 1 : -1;
}

function getRoleAnchor(
  summary: AxialStretchObjectSummary,
  role: RoleBadgeRole,
) {
  if (role === "stretchTarget") {
    return midpoint(summary.negativeEndWorld, summary.positiveEndWorld);
  }

  if (role === "moveWithEnd") {
    return getLowerEnd(summary);
  }

  return getUpperEnd(summary);
}

function getBadgePosition(
  anchor: [number, number, number],
  summary: AxialStretchObjectSummary,
  role: RoleBadgeRole,
): [number, number, number] {
  const side = pathKeyOffsetSign(summary.pathKey);

  const baseOffset = Math.max(summary.crossSectionSize * 4, 0.045);
  const verticalOffset = Math.max(summary.crossSectionSize * 2.5, 0.035);

  if (role === "stretchTarget") {
    return [
      anchor[0] + side * baseOffset,
      anchor[1] + verticalOffset,
      anchor[2],
    ];
  }

  if (role === "moveWithEnd") {
    return [
      anchor[0] + side * baseOffset,
      anchor[1] + verticalOffset * 0.6,
      anchor[2],
    ];
  }

  return [anchor[0] + side * baseOffset, anchor[1] + verticalOffset, anchor[2]];
}

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["high", "medium", "low"];

function getNextConfidenceLevel(level: ConfidenceLevel) {
  const index = CONFIDENCE_ORDER.indexOf(level);

  return CONFIDENCE_ORDER[(index + 1) % CONFIDENCE_ORDER.length];
}

function getConfidencePosition(
  summary: AxialStretchObjectSummary,
): [number, number, number] {
  const center = summary.aabbCenterWorld;
  const offset = Math.max(summary.crossSectionSize * 5, 0.08);

  return [center[0] + offset, center[1] + offset * 0.35, center[2]];
}

function ConfidenceEditorWidget({
  summary,
  editor,
}: {
  summary: AxialStretchObjectSummary;
  editor: FuzzyConfidenceEditor;
}) {
  const position = getConfidencePosition(summary);
  const axes: ConfidenceAxis[] = ["x", "y", "z"];

  return (
    <Html position={position} center distanceFactor={0.8} occlude={false}>
      <div
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        style={{
          minWidth: 230,
          padding: "10px",
          borderRadius: 14,
          border: "1px solid rgba(43, 108, 255, 0.45)",
          background: "rgba(255, 255, 255, 0.9)",
          boxShadow: "0 12px 34px rgba(15, 23, 42, 0.22)",
          backdropFilter: "blur(14px)",
          fontFamily: "Arial, sans-serif",
          color: "#172033",
          pointerEvents: "auto",
          userSelect: "none",
        }}
      >
        <div
          style={{
            marginBottom: 8,
            fontSize: 11,
            fontWeight: 800,
            color: "#2b6cff",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Dimension confidence
        </div>

        {axes.map((axis) => {
          const level = editor.confidence[axis];
          const direction = editor.directions[axis];

          return (
            <div
              key={axis}
              style={{
                display: "grid",
                gridTemplateColumns: "22px 82px 1fr",
                gap: 6,
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  color: "#334155",
                }}
              >
                {axis.toUpperCase()}
              </div>

              <button
                type="button"
                onClick={() => {
                  editor.onConfidenceChange(
                    axis,
                    getNextConfidenceLevel(level),
                  );
                }}
                style={{
                  height: 28,
                  border: "1px solid rgba(148, 163, 184, 0.42)",
                  borderRadius: 9,
                  background:
                    level === "low"
                      ? "rgba(20, 85, 255, 0.18)"
                      : level === "medium"
                        ? "rgba(158, 220, 255, 0.3)"
                        : "rgba(255, 255, 255, 0.72)",
                  color: "#334155",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "capitalize",
                }}
              >
                {level}
              </button>

              <select
                value={direction}
                disabled={level === "high"}
                onChange={(event) => {
                  editor.onDirectionChange(
                    axis,
                    event.target.value as ConfidenceDirection,
                  );
                }}
                style={{
                  height: 28,
                  border: "1px solid rgba(148, 163, 184, 0.42)",
                  borderRadius: 9,
                  background:
                    level === "high"
                      ? "rgba(241, 245, 249, 0.8)"
                      : "rgba(255,255,255,0.82)",
                  color: level === "high" ? "#94a3b8" : "#334155",
                  cursor: level === "high" ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <option value="both">both</option>
                <option value="positive">positive</option>
                <option value="negative">negative</option>
              </select>
            </div>
          );
        })}

        <div
          style={{
            display: "flex",
            justifyContent: editor.canRemove ? "space-between" : "flex-end",
            gap: 6,
            marginTop: 8,
          }}
        >
          {editor.canRemove && editor.onRemove ? (
            <button
              type="button"
              onClick={editor.onRemove}
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 8,
                border: "1px solid rgba(239, 68, 68, 0.55)",
                background: "rgba(254, 242, 242, 0.85)",
                color: "#dc2626",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              Remove
            </button>
          ) : null}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={editor.onCancel}
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 8,
                border: "1px solid rgba(148, 163, 184, 0.6)",
                background: "rgba(255,255,255,0.7)",
                color: "#475569",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={editor.onApply}
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 8,
                border: "1px solid #2b6cff",
                background: "#2b6cff",
                color: "white",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </Html>
  );
}

function getObjectAxisFrame(
  summary: AxialStretchObjectSummary,
): ConfidenceAxisFrame {
  const yAxis = new THREE.Vector3(...summary.principalAxisWorld);

  if (yAxis.lengthSq() < 1e-10) {
    yAxis.set(0, 1, 0);
  } else {
    yAxis.normalize();
  }

  const worldUp = new THREE.Vector3(0, 1, 0);
  const worldX = new THREE.Vector3(1, 0, 0);

  const helper = Math.abs(yAxis.dot(worldUp)) > 0.92 ? worldX : worldUp;

  const xAxis = new THREE.Vector3().crossVectors(helper, yAxis).normalize();

  const zAxis = new THREE.Vector3().crossVectors(yAxis, xAxis).normalize();

  return {
    x: [xAxis.x, xAxis.y, xAxis.z],
    y: [yAxis.x, yAxis.y, yAxis.z],
    z: [zAxis.x, zAxis.y, zAxis.z],
  };
}

function getAxisVectorFromFrame(
  frame: ConfidenceAxisFrame,
  axis: ConfidenceAxis,
) {
  return new THREE.Vector3(...frame[axis]).normalize();
}

type UncertaintyArrowSpec = {
  pathKey: string;
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
  direction: "positive" | "negative";
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  label: string;
};

function getArrowColor(level: ConfidenceLevel) {
  return level === "low" ? "#1455ff" : "#9edcff";
}

function getArrowLength(
  level: ConfidenceLevel,
  summary: AxialStretchObjectSummary,
) {
  const base = Math.max(summary.crossSectionSize * 2.2, 0.06);

  return level === "low" ? base * 1.45 : base;
}

function getArrowStart(
  summary: AxialStretchObjectSummary,
  frame: ConfidenceAxisFrame,
  axis: ConfidenceAxis,
  direction: "positive" | "negative",
): [number, number, number] {
  const center = new THREE.Vector3(...summary.aabbCenterWorld);
  const axisVector = getAxisVectorFromFrame(frame, axis);
  const sign = direction === "positive" ? 1 : -1;

  const halfLengthAlongAxis =
    axis === "y"
      ? summary.axisLength / 2
      : Math.max(summary.crossSectionSize * 1.2, 0.035);

  const pad = Math.max(summary.crossSectionSize * 0.9, 0.025);

  const start = center
    .clone()
    .add(axisVector.clone().multiplyScalar(sign * (halfLengthAlongAxis + pad)));

  return [start.x, start.y, start.z];
}

function getArrowEnd(
  start: [number, number, number],
  frame: ConfidenceAxisFrame,
  axis: ConfidenceAxis,
  direction: "positive" | "negative",
  length: number,
): [number, number, number] {
  const startVector = new THREE.Vector3(...start);
  const axisVector = getAxisVectorFromFrame(frame, axis);
  const sign = direction === "positive" ? 1 : -1;

  const end = startVector.add(axisVector.multiplyScalar(sign * length));

  return [end.x, end.y, end.z];
}

function UncertaintyArrow({
  start,
  end,
  color,
  label,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  label: string;
}) {
  const origin = useMemo(
    () => new THREE.Vector3(start[0], start[1], start[2]),
    [start],
  );

  const direction = useMemo(() => {
    const dir = new THREE.Vector3(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    );

    return dir.normalize();
  }, [start, end]);

  const length = useMemo(() => {
    return new THREE.Vector3(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ).length();
  }, [start, end]);

  const headLength = Math.min(length * 0.32, 0.08);
  const headWidth = Math.min(headLength * 0.55, 0.04);

  return (
    <>
      <arrowHelper
        args={[direction, origin, length, color, headLength, headWidth]}
      />
      <Html position={end} center distanceFactor={0.8} occlude={false}>
        <div
          style={{
            minWidth: 18,
            height: 18,
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            border: `1px solid ${color}`,
            color,
            fontSize: 11,
            fontWeight: 800,
            lineHeight: "16px",
            textAlign: "center",
            boxShadow: "0 6px 18px rgba(15,23,42,0.18)",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {label}
        </div>
      </Html>
    </>
  );
}

function UncertaintyLegendOverlay() {
  return (
    <Html fullscreen style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: 90,
          left: 14,
          width: 230,
          padding: "12px 12px 10px",
          borderRadius: 14,
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(148,163,184,0.35)",
          boxShadow: "0 12px 28px rgba(15,23,42,0.18)",
          backdropFilter: "blur(10px)",
          fontFamily: "Arial, sans-serif",
          color: "#172033",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            marginBottom: 8,
            color: "#1e293b",
          }}
        >
          Confidence legend
        </div>

        <div
          style={{
            display: "grid",
            rowGap: 8,
            fontSize: 11,
            color: "#334155",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 18,
                height: 10,
                borderRadius: 999,
                background: "rgba(158, 220, 255, 0.65)",
                border: "1px solid rgba(158, 220, 255, 0.95)",
              }}
            />
            <span>Medium confidence: narrow light-blue shell</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 10,
                borderRadius: 999,
                background: "rgba(20, 85, 255, 0.72)",
                border: "1px solid rgba(20, 85, 255, 0.98)",
              }}
            />
            <span>Low confidence: wider dark-blue shell</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderLeft: "12px solid #1455ff",
                marginLeft: 4,
              }}
            />
            <span>Arrow: uncertainty direction</span>
          </div>

          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            No shell = high confidence
          </div>
        </div>
      </div>
    </Html>
  );
}

/**
 * Renders the two-line + arc angle visualization for the Angle tool.
 *
 * - Gray line: fixed reference direction (line 1)
 * - Blue line: adjustable direction (line 2), rotated by `angleDeg` from line 1
 * - Blue arc: sweeps from line 1 to line 2, at 35% of `radius`
 * - θ label: shown at the arc midpoint
 * - Drag handle: circle at line 2 endpoint; dragging rotates it around the pivot
 *
 * Uses imperative BufferGeometry creation to avoid R3F declarative
 * bufferAttribute quirks.
 */
function AngleArcOverlay({
  pivot,
  line1Dir,
  normalAxis,
  angleDeg,
  radius,
  onDrag,
}: {
  pivot: THREE.Vector3;
  line1Dir: THREE.Vector3;
  normalAxis: THREE.Vector3;
  angleDeg: number;
  radius: number;
  onDrag: (deg: number) => void;
}) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);

  const { line1Geo, line2Geo, arcGeo, line2End, thetaPos } = useMemo(() => {
    // line2Dir = line1Dir rotated by angleDeg around normalAxis
    const q = new THREE.Quaternion().setFromAxisAngle(
      normalAxis,
      (angleDeg * Math.PI) / 180,
    );
    const dir2 = line1Dir.clone().applyQuaternion(q).normalize();

    const end1 = pivot.clone().add(line1Dir.clone().multiplyScalar(radius));
    const end2 = pivot.clone().add(dir2.clone().multiplyScalar(radius));

    // Arc: 48 steps from line1Dir toward line2Dir at 35% radius
    const ARC_STEPS = 48;
    const arcPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = i / ARC_STEPS;
      const qStep = new THREE.Quaternion().setFromAxisAngle(
        normalAxis,
        (t * angleDeg * Math.PI) / 180,
      );
      arcPoints.push(
        pivot
          .clone()
          .add(
            line1Dir
              .clone()
              .applyQuaternion(qStep)
              .normalize()
              .multiplyScalar(radius * 0.35),
          ),
      );
    }

    // θ label at arc midpoint
    const qMid = new THREE.Quaternion().setFromAxisAngle(
      normalAxis,
      ((angleDeg / 2) * Math.PI) / 180,
    );
    const thetaPosition = pivot
      .clone()
      .add(
        line1Dir
          .clone()
          .applyQuaternion(qMid)
          .normalize()
          .multiplyScalar(radius * 0.52),
      );

    return {
      line1Geo: new THREE.BufferGeometry().setFromPoints([pivot.clone(), end1]),
      line2Geo: new THREE.BufferGeometry().setFromPoints([pivot.clone(), end2]),
      arcGeo: new THREE.BufferGeometry().setFromPoints(arcPoints),
      line2End: end2,
      thetaPos: thetaPosition,
    };
  }, [pivot, line1Dir, normalAxis, angleDeg, radius]);

  // Dispose geometries when they are no longer needed
  useEffect(() => {
    return () => {
      line1Geo.dispose();
      line2Geo.dispose();
      arcGeo.dispose();
    };
  }, [line1Geo, line2Geo, arcGeo]);

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const rect = gl.domElement.getBoundingClientRect();
    const pivotScreen = projectToScreen(pivot, camera, rect);
    if (!pivotScreen) return;

    const pivotClientX = rect.left + pivotScreen.x;
    const pivotClientY = rect.top + pivotScreen.y;
    const startScreenAngle = Math.atan2(
      event.clientY - pivotClientY,
      event.clientX - pivotClientX,
    );
    const startDeg = angleDeg;

    const onMove = (me: PointerEvent) => {
      const a = Math.atan2(
        me.clientY - pivotClientY,
        me.clientX - pivotClientX,
      );
      const delta = ((a - startScreenAngle) * 180) / Math.PI;
      onDrag(Math.max(0, Math.min(179, startDeg + delta)));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setDragging(true);
  }

  return (
    <>
      {/* Line 1 — gray reference */}
      <primitive object={new THREE.Line(line1Geo, new THREE.LineBasicMaterial({ color: "#94a3b8" }))} />

      {/* Line 2 — blue adjustable */}
      <primitive object={new THREE.Line(line2Geo, new THREE.LineBasicMaterial({ color: "#2b6cff" }))} />

      {/* Arc between the two lines */}
      <primitive object={new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: "#2b6cff" }))} />

      {/* Drag handle at end of line 2 */}
      <Html
        position={[line2End.x, line2End.y, line2End.z]}
        center
        distanceFactor={0.8}
        occlude={false}
      >
        <div
          onPointerDown={handlePointerDown}
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: dragging ? "#1a52d4" : "#2b6cff",
            border: "2.5px solid white",
            cursor: "grab",
            boxShadow: "0 2px 8px rgba(43,108,255,0.5)",
            pointerEvents: "auto",
          }}
        />
      </Html>

      {/* θ label */}
      <Html
        position={[thetaPos.x, thetaPos.y, thetaPos.z]}
        center
        distanceFactor={0.8}
        occlude={false}
      >
        <div
          style={{
            fontFamily: "Arial, sans-serif",
            fontSize: 12,
            fontWeight: 700,
            color: "#172033",
            pointerEvents: "none",
            userSelect: "none",
            background: "rgba(255,255,255,0.88)",
            padding: "2px 7px",
            borderRadius: 6,
            border: "1px solid rgba(43,108,255,0.35)",
            boxShadow: "0 2px 8px rgba(15,23,42,0.12)",
          }}
        >
          θ = {Math.abs(angleDeg).toFixed(1)}°
        </div>
      </Html>
    </>
  );
}

/**
 * Snap a raycast hit to the nearest actual vertex of the clicked mesh,
 * returned in world space.
 *
 * For small geometries every vertex is checked; for large ones only the three
 * vertices of the intersected triangle are considered (still real mesh
 * vertices, just a coarser snap).
 */
function snapToNearestVertexWorld(
  event: ThreeEvent<PointerEvent>,
): THREE.Vector3 {
  const mesh = event.object as THREE.Mesh;
  const position = mesh.geometry?.attributes?.position;

  if (!position) {
    return event.point.clone();
  }

  mesh.updateWorldMatrix(true, false);
  const localHit = mesh.worldToLocal(event.point.clone());

  const FULL_SCAN_LIMIT = 60000;
  const candidate = new THREE.Vector3();
  let bestIndex = -1;
  let bestDistanceSq = Infinity;

  const consider = (index: number) => {
    candidate.fromBufferAttribute(position, index);
    const distanceSq = candidate.distanceToSquared(localHit);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
    }
  };

  if (position.count > FULL_SCAN_LIMIT && event.face) {
    consider(event.face.a);
    consider(event.face.b);
    consider(event.face.c);
  } else {
    for (let index = 0; index < position.count; index++) {
      consider(index);
    }
  }

  if (bestIndex < 0) {
    return event.point.clone();
  }

  candidate.fromBufferAttribute(position, bestIndex);
  return mesh.localToWorld(candidate.clone());
}

function Model({
  url,
  placements,
  highlightedPathKey,
  selectedPathKeys,
  activeTool,
  confidenceAnnotations,
  confidenceEditor,
  activePathKeys,
  manipulationValue,
  rolePreviewPlan,
  confirmedHeightPlan,
  enableManipulationHandles = true,
  lassoPolygon,

  onMeshGraph,
  onObjectSummaries,
  onSelectedNode,
  onSelectedPathKey,
  onObjectLassoSelection,
  onManipulationChange,
  onManipulationDragStateChange,
  angleTargetDeg,
  angleMateEdges,
  angleResetNonce,
  onAngleSelection,
}: {
  url: string;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  activeTool?: OperationTool;
  confidenceAnnotations?: FuzzyConfidenceAnnotation[];
  confidenceEditor?: FuzzyConfidenceEditor | null;
  activePathKeys?: string[];
  manipulationValue?: number;
  rolePreviewPlan?: RolePreviewPlan | null;
  confirmedHeightPlan?: AxialStretchRolePlan | null;
  enableManipulationHandles?: boolean;
  lassoPolygon?: ScreenPoint[] | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onObjectSummaries?: (summaries: AxialStretchObjectSummary[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
  onObjectLassoSelection?: (pathKeys: string[]) => void;
  onManipulationChange?: (value: number) => void;
  onManipulationDragStateChange?: (dragging: boolean) => void;
  angleTargetDeg?: number | null;
  angleMateEdges?: MateGraphEdge[];
  angleResetNonce?: number;
  onAngleSelection?: (data: {
    part1PathKey: string;
    part2PathKey: string;
    angleDeg: number;
    measuredAngleDeg: number;
    face1Normal?: [number, number, number];
    face2Normal?: [number, number, number];
    pivot?: [number, number, number];
  }) => void;
}) {
  const gltf = useGLTF(url);
  const graphRef = useRef<MeshGraphNode[]>([]);
  const { camera, gl, invalidate } = useThree();

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true);

    prepareRenderableMeshes(cloned);
    applyPlacements(cloned, placements ?? []);
    cloned.rotation.x = -Math.PI / 2;

    return cloned;
  }, [gltf.scene, placements]);

  const objectSummaries = useMemo(
    () => buildObjectSummaries(scene, selectedPathKeys ?? []),
    [scene, selectedPathKeys],
  );

  const axisFramesByPathKey = useMemo(() => {
    const frames = new Map<string, ConfidenceAxisFrame>();

    for (const summary of objectSummaries) {
      frames.set(summary.pathKey, getObjectAxisFrame(summary));
    }

    return frames;
  }, [objectSummaries]);

  const heightPreviewSession = useMemo(() => {
    if (!confirmedHeightPlan) {
      return null;
    }

    return createAxialStretchPreviewSession(
      scene,
      objectSummaries,
      confirmedHeightPlan,
    );
  }, [scene, objectSummaries, confirmedHeightPlan]);

  const visualConfidenceAnnotations = useMemo(() => {
    const base = confidenceAnnotations ?? [];

    if (!confidenceEditor) {
      return base;
    }

    return [
      ...base.filter((item) => item.pathKey !== confidenceEditor.pathKey),
      {
        pathKey: confidenceEditor.pathKey,
        confidence: confidenceEditor.confidence,
        directions: confidenceEditor.directions,
      },
    ];
  }, [confidenceAnnotations, confidenceEditor]);

  useEffect(() => {
    if (!heightPreviewSession) {
      return;
    }

    scene.add(heightPreviewSession.group);
    invalidate();

    return () => {
      disposeAxialStretchPreviewSession(heightPreviewSession);
      invalidate();
    };
  }, [scene, heightPreviewSession, invalidate]);

  useEffect(() => {
    const graph = buildMeshGraph(scene);
    graphRef.current = graph;
    onMeshGraph?.(graph);
    onSelectedNode?.(null);
  }, [scene, onMeshGraph, onSelectedNode]);

  useEffect(() => {
    onObjectSummaries?.(objectSummaries);
  }, [objectSummaries, onObjectSummaries]);

  useEffect(() => {
    if (!lassoPolygon || lassoPolygon.length < 3) {
      return;
    }

    const pathKeys = selectPathKeysByLasso(
      scene,
      camera,
      gl.domElement,
      lassoPolygon,
    );

    onObjectLassoSelection?.(pathKeys);
  }, [scene, camera, gl, lassoPolygon, onObjectLassoSelection]);

  // ── Angle tool selection: pivot vertex → face 1 (fixed) → face 2 (rotates) ──
  // The vertex click is snapped to the nearest actual mesh vertex; each face
  // click captures the clicked face's world-space normal.
  // Declared before the highlight useEffect so the effect can reference them.
  type FaceSelection = {
    pathKey: string;
    /** Face normal in Three.js viewer world space (scene has rotation.x = -π/2). */
    faceNormal: THREE.Vector3;
    /** World-space click point. */
    hitPoint: THREE.Vector3;
  };

  type VertexSelection = {
    pathKey: string;
    /** Snapped mesh vertex in viewer world space — the rotation pivot. */
    point: THREE.Vector3;
  };

  const [angleVertex, setAngleVertex] = useState<VertexSelection | null>(null);
  const [angleFace1, setAngleFace1] = useState<FaceSelection | null>(null);
  const [angleFace2, setAngleFace2] = useState<FaceSelection | null>(null);
  /** Measured angle between the two face normals at click time (deg). */
  const [angleMeasuredDeg, setAngleMeasuredDeg] = useState<number | null>(null);
  /** Target angle the user is editing toward (deg). */
  const [angleArcDeg, setAngleArcDeg] = useState<number>(45);

  useEffect(() => {
    // When the angle tool is active, highlight whichever parts have been selected
    // for the angle measurement so it's clear what's being compared.
    if (activeTool === "angle") {
      const angleKeys = [angleFace1?.pathKey ?? null, angleFace2?.pathKey ?? null].filter(
        (k): k is string => k !== null,
      );
      applyPathHighlight(scene, angleKeys.length > 0 ? angleKeys : null);
      invalidate();
      return;
    }

    const activeHighlights =
      selectedPathKeys && selectedPathKeys.length > 0
        ? selectedPathKeys
        : highlightedPathKey;

    applyPathHighlight(scene, activeHighlights);
    invalidate();
  }, [scene, highlightedPathKey, selectedPathKeys, activeTool, angleFace1, angleFace2, invalidate]);

  useEffect(() => {
    applyFuzzyConfidence(
      scene,
      visualConfidenceAnnotations,
      axisFramesByPathKey,
    );
    invalidate();

    return () => {
      applyFuzzyConfidence(scene, []);
      invalidate();
    };
  }, [scene, visualConfidenceAnnotations, axisFramesByPathKey, invalidate]);

  // --- Sizing / angle handle setup -------------------------------------

  const handleConfig = useMemo<HandleConfig>(() => {
    if (!enableManipulationHandles) {
      return null;
    }

    if (
      activeTool === "height" &&
      confirmedHeightPlan &&
      heightPreviewSession
    ) {
      const handle = getAxialStretchPreviewHandle(heightPreviewSession);

      return {
        kind: "heightStretch",
        baseWorld: handle.baseWorld,
        axisWorld: handle.axisWorld,
        length: handle.length,
        session: heightPreviewSession,
      };
    }

    if (
      !activePathKeys ||
      activePathKeys.length === 0 ||
      (activeTool !== "height" &&
        activeTool !== "extend" &&
        activeTool !== "angle")
    ) {
      return null;
    }

    const activeSummaries = objectSummaries.filter((summary) =>
      activePathKeys.includes(summary.pathKey),
    );

    if (activeSummaries.length === 0) {
      return null;
    }

    const objects = findObjectsByPathKeys(scene, activePathKeys);

    if (objects.length === 0) {
      return null;
    }

    if (activeTool === "height") {
      let baseY = Infinity;
      let tipY = -Infinity;
      let anchorX = 0;
      let anchorZ = 0;

      for (const summary of activeSummaries) {
        const a = summary.negativeEndWorld;
        const b = summary.positiveEndWorld;

        baseY = Math.min(baseY, a[1], b[1]);
        tipY = Math.max(tipY, a[1], b[1]);
        anchorX += (a[0] + b[0]) / 2;
        anchorZ += (a[2] + b[2]) / 2;
      }

      anchorX /= activeSummaries.length;
      anchorZ /= activeSummaries.length;

      return {
        kind: "axial",
        baseWorld: new THREE.Vector3(anchorX, baseY, anchorZ),
        axisWorld: new THREE.Vector3(0, 1, 0),
        length: Math.max(tipY - baseY, 0),
        objects,
      };
    }

    if (activeTool === "extend") {
      const primary = activeSummaries[0];
      const axis = new THREE.Vector3(...primary.principalAxisWorld);

      if (axis.lengthSq() < 1e-12) {
        axis.set(0, 1, 0);
      } else {
        axis.normalize();
      }

      return {
        kind: "axial",
        baseWorld: new THREE.Vector3(...primary.negativeEndWorld),
        axisWorld: axis,
        length: primary.axisLength,
        objects,
      };
    }

    const primary = activeSummaries[0];

    return {
      kind: "angle",
      pivotWorld: new THREE.Vector3(...primary.negativeEndWorld),
      objects,
    };
  }, [
    activePathKeys,
    activeTool,
    confirmedHeightPlan,
    enableManipulationHandles,
    heightPreviewSession,
    objectSummaries,
    scene,
  ]);

  const roleBadges = useMemo(() => {
    if (!rolePreviewPlan) {
      return [];
    }

    const stretchSet = new Set(rolePreviewPlan.stretchTargetPathKeys);
    const moveSet = new Set(rolePreviewPlan.moveWithEndPathKeys);
    const fixedSet = new Set(rolePreviewPlan.fixedAnchorPathKeys);

    return objectSummaries
      .map((summary) => {
        let role: RoleBadgeRole | null = null;

        if (stretchSet.has(summary.pathKey)) {
          role = "stretchTarget";
        } else if (moveSet.has(summary.pathKey)) {
          role = "moveWithEnd";
        } else if (fixedSet.has(summary.pathKey)) {
          role = "fixedAnchor";
        }

        if (!role) {
          return null;
        }

        const anchorPosition = getRoleAnchor(summary, role);
        const position = getBadgePosition(anchorPosition, summary, role);

        return {
          pathKey: summary.pathKey,
          role,
          anchorPosition,
          position,
        };
      })
      .filter(
        (
          item,
        ): item is {
          pathKey: string;
          role: RoleBadgeRole;
          anchorPosition: [number, number, number];
          position: [number, number, number];
        } => item !== null,
      );
  }, [objectSummaries, rolePreviewPlan]);

  const confidenceEditorSummary = useMemo(() => {
    if (!confidenceEditor) {
      return null;
    }

    return (
      objectSummaries.find(
        (summary) => summary.pathKey === confidenceEditor.pathKey,
      ) ?? null
    );
  }, [confidenceEditor, objectSummaries]);

  const uncertaintyArrows = useMemo(() => {
    const summaryByPathKey = new Map(
      objectSummaries.map((summary) => [summary.pathKey, summary]),
    );

    const arrows: UncertaintyArrowSpec[] = [];

    for (const annotation of visualConfidenceAnnotations) {
      const summary = summaryByPathKey.get(annotation.pathKey);

      if (!summary) {
        continue;
      }

      const frame =
        axisFramesByPathKey.get(summary.pathKey) ?? getObjectAxisFrame(summary);

      (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
        const level = annotation.confidence[axis];

        if (level === "high") {
          return;
        }

        const axisDirection = annotation.directions?.[axis] ?? "both";

        const arrowDirections: ("positive" | "negative")[] =
          axisDirection === "both" ? ["positive", "negative"] : [axisDirection];

        for (const direction of arrowDirections) {
          const start = getArrowStart(summary, frame, axis, direction);
          const length = getArrowLength(level, summary);
          const end = getArrowEnd(start, frame, axis, direction, length);

          arrows.push({
            pathKey: annotation.pathKey,
            axis,
            level,
            direction,
            start,
            end,
            color: getArrowColor(level),
            label: `${axis.toUpperCase()}${
              direction === "positive" ? "+" : "−"
            }`,
          });
        }
      });
    }

    return arrows;
  }, [objectSummaries, visualConfidenceAnnotations, axisFramesByPathKey]);

  const appliedValueRef = useRef(0);
  const angleAxisRef = useRef(new THREE.Vector3(0, 0, 1));

  // ── Angle tool: vertex + two-face selection, live rotation preview ──────

  /**
   * Live-preview state: which objects have been rotated, around what axis and
   * pivot, and by how much. Kept in a ref (not React state) so the reverse
   * rotation always uses exactly what was applied — no stale-closure risk.
   */
  const anglePreviewRef = useRef<{
    objects: THREE.Object3D[];
    pivot: THREE.Vector3;
    axis: THREE.Vector3;
    appliedRad: number;
  } | null>(null);

  const resetAnglePreview = useCallback(() => {
    const preview = anglePreviewRef.current;
    if (preview && Math.abs(preview.appliedRad) > 1e-12) {
      rotateObjectsAroundWorldAxis(
        preview.objects,
        preview.pivot,
        preview.axis,
        -preview.appliedRad,
      );
    }
    anglePreviewRef.current = null;
    invalidate();
  }, [invalidate]);

  const resetAngleSelection = useCallback(() => {
    resetAnglePreview();
    setAngleVertex(null);
    setAngleFace1(null);
    setAngleFace2(null);
    setAngleMeasuredDeg(null);
    setAngleArcDeg(45);
  }, [resetAnglePreview]);

  // Reset selection when leaving angle tool or when the parent forces a reset
  // (after saving/cancelling a pending mark).
  useEffect(() => {
    if (activeTool !== "angle") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resetAngleSelection();
    }
  }, [activeTool, resetAngleSelection]);

  useEffect(() => {
    if (angleResetNonce !== undefined && angleResetNonce > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resetAngleSelection();
    }
  }, [angleResetNonce, resetAngleSelection]);

  // If the scene is replaced (reload), any applied preview transform is gone.
  useEffect(() => {
    anglePreviewRef.current = null;
  }, [scene]);

  // Sync target angle from the sidebar panel's numeric input.
  // (Intentional controlled-prop sync — disable the strict compiler rule.)
  useEffect(() => {
    if (angleTargetDeg == null || !angleFace2) return;
    const clamped = Math.max(0, Math.min(179, angleTargetDeg));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAngleArcDeg((current) =>
      Math.abs(clamped - current) > 1e-4 ? clamped : current,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angleTargetDeg]);

  // Notify parent when the full selection exists and whenever the target changes
  useEffect(() => {
    if (!angleVertex || !angleFace1 || !angleFace2 || angleMeasuredDeg == null) return;
    onAngleSelection?.({
      part1PathKey: angleFace1.pathKey,
      part2PathKey: angleFace2.pathKey,
      angleDeg: angleArcDeg,
      measuredAngleDeg: angleMeasuredDeg,
      face1Normal: angleFace1.faceNormal.toArray() as [number, number, number],
      face2Normal: angleFace2.faceNormal.toArray() as [number, number, number],
      pivot: angleVertex.point.toArray() as [number, number, number],
    });
  }, [angleVertex, angleFace1, angleFace2, angleArcDeg, angleMeasuredDeg, onAngleSelection]);

  // Compute the 3D geometry config for the arc overlay
  const angleOverlayConfig = useMemo(() => {
    if (!angleVertex || !angleFace1 || !angleFace2) return null;

    const n1 = angleFace1.faceNormal.clone().normalize();
    const n2 = angleFace2.faceNormal.clone().normalize();

    // Hinge axis: perpendicular to both face normals
    let normalAxis = new THREE.Vector3().crossVectors(n1, n2);
    if (normalAxis.lengthSq() < 0.0001) {
      // Parallel normals — fall back to a plausible axis
      normalAxis = Math.abs(n1.y) < 0.9
        ? new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n1)
        : new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), n1);
    }
    normalAxis.normalize();

    // The snapped vertex is the rotation pivot
    const pivot = angleVertex.point.clone();

    // Arc radius based on part sizes (look up summaries for scale)
    const sum1 = objectSummaries.find((s) => s.pathKey === angleFace1.pathKey);
    const sum2 = objectSummaries.find((s) => s.pathKey === angleFace2.pathKey);
    const radius = Math.max(
      (sum1?.axisLength ?? 0.1) * 0.5,
      (sum2?.axisLength ?? 0.1) * 0.5,
      0.05,
    );

    return { pivot, line1Dir: n1, normalAxis, radius };
  }, [angleVertex, angleFace1, angleFace2, objectSummaries]);

  // Live rotation preview: rotate part 2 (+ its rigid mate group) around the
  // hinge axis through the pivot vertex by (target − measured). Incremental —
  // each run applies only the difference from what is already applied.
  useEffect(() => {
    if (
      activeTool !== "angle" ||
      !angleOverlayConfig ||
      !angleFace1 ||
      !angleFace2 ||
      angleMeasuredDeg == null
    ) {
      return;
    }

    let preview = anglePreviewRef.current;

    if (!preview) {
      const relatedKeys = findMateConnectedParts(
        angleFace2.pathKey,
        angleFace1.pathKey,
        angleMateEdges ?? [],
      );
      const objects = findTopLevelObjectsByPathKeys(scene, [
        angleFace2.pathKey,
        ...relatedKeys,
      ]);

      if (objects.length === 0) return;

      preview = {
        objects,
        pivot: angleOverlayConfig.pivot.clone(),
        axis: angleOverlayConfig.normalAxis.clone(),
        appliedRad: 0,
      };
      anglePreviewRef.current = preview;
    }

    const targetRad = THREE.MathUtils.degToRad(angleArcDeg - angleMeasuredDeg);
    const diff = targetRad - preview.appliedRad;

    if (Math.abs(diff) < 1e-9) return;

    rotateObjectsAroundWorldAxis(preview.objects, preview.pivot, preview.axis, diff);
    anglePreviewRef.current = { ...preview, appliedRad: targetRad };
    invalidate();
  }, [
    activeTool,
    angleOverlayConfig,
    angleFace1,
    angleFace2,
    angleMeasuredDeg,
    angleArcDeg,
    angleMateEdges,
    scene,
    invalidate,
  ]);

  useEffect(() => {
    appliedValueRef.current = 0;
  }, [handleConfig]);

  useEffect(() => {
    if (!handleConfig) {
      return;
    }

    const targetValue = manipulationValue ?? 0;
    const diff = targetValue - appliedValueRef.current;

    if (Math.abs(diff) < 1e-9) {
      return;
    }

    if (handleConfig.kind === "heightStretch") {
      updateAxialStretchPreviewSession(handleConfig.session, targetValue);
      appliedValueRef.current = targetValue;
      invalidate();
      return;
    }

    if (handleConfig.kind === "axial") {
      translateObjectsWorld(
        handleConfig.objects,
        handleConfig.axisWorld.clone().multiplyScalar(diff),
      );
    } else {
      rotateObjectsAroundWorldAxis(
        handleConfig.objects,
        handleConfig.pivotWorld,
        angleAxisRef.current,
        THREE.MathUtils.degToRad(diff),
      );
    }

    appliedValueRef.current = targetValue;
    invalidate();
  }, [manipulationValue, handleConfig, invalidate]);

  function handleDragStateChange(dragging: boolean) {
    if (dragging && handleConfig?.kind === "angle") {
      camera.getWorldDirection(angleAxisRef.current);
    }

    onManipulationDragStateChange?.(dragging);
  }

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();

    const selectedObject = event.object;
    const graph = graphRef.current;

    const selectedNode =
      graph.find((node) => node.nodeId === selectedObject.uuid) ?? null;

    const selectedPathKey = findFuzzyPathKey(selectedObject);

    // Angle tool: intercept clicks for vertex → face 1 → face 2 selection
    if (activeTool === "angle" && selectedPathKey) {
      // Step 1: pivot vertex — snap the raycast hit to the nearest actual
      // mesh vertex of the clicked object.
      if (!angleVertex) {
        setAngleVertex({
          pathKey: selectedPathKey,
          point: snapToNearestVertexWorld(event),
        });
        return;
      }

      // Steps 2/3: face picks — capture the clicked face's world-space normal.
      let faceNormal = new THREE.Vector3(0, 1, 0); // fallback
      if (event.face) {
        const localNormal = event.face.normal.clone();
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(
          event.object.matrixWorld,
        );
        faceNormal = localNormal.applyMatrix3(normalMatrix).normalize();
      }

      const selection = {
        pathKey: selectedPathKey,
        faceNormal,
        hitPoint: event.point.clone(),
      };

      if (!angleFace1) {
        setAngleFace1(selection);
      } else if (!angleFace2 && selectedPathKey !== angleFace1.pathKey) {
        // Record the measured angle between the two face normals and start
        // the editable target there (absolute-angle semantics).
        const cosAngle = Math.max(
          -1,
          Math.min(1, angleFace1.faceNormal.dot(selection.faceNormal)),
        );
        const measured = (Math.acos(cosAngle) * 180) / Math.PI;
        setAngleFace2(selection);
        setAngleMeasuredDeg(measured);
        setAngleArcDeg(measured);
      } else if (!angleFace2) {
        // Second face must be on a different part — ignore the click.
        return;
      } else {
        // Selection already complete: restart with a fresh pivot vertex.
        resetAnglePreview();
        setAngleVertex({
          pathKey: selectedPathKey,
          point: snapToNearestVertexWorld(event),
        });
        setAngleFace1(null);
        setAngleFace2(null);
        setAngleMeasuredDeg(null);
        setAngleArcDeg(45);
      }
      return;
    }

    onSelectedNode?.(selectedNode);
    onSelectedPathKey?.(selectedPathKey);
  }

  const manipulationValueOrZero = manipulationValue ?? 0;

  return (
    <>
      <primitive object={scene} onPointerDown={handlePointerDown} />

      {roleBadges.map((badge) => (
        <RoleBadge
          key={`${badge.role}:${badge.pathKey}`}
          anchorPosition={badge.anchorPosition}
          position={badge.position}
          role={badge.role}
        />
      ))}

      {confidenceEditor && confidenceEditorSummary ? (
        <ConfidenceEditorWidget
          summary={confidenceEditorSummary}
          editor={confidenceEditor}
        />
      ) : null}

      {uncertaintyArrows.map((arrow) => (
        <UncertaintyArrow
          key={`${arrow.pathKey}:${arrow.axis}:${arrow.direction}`}
          start={arrow.start}
          end={arrow.end}
          color={arrow.color}
          label={arrow.label}
        />
      ))}

      {visualConfidenceAnnotations.length > 0 || confidenceEditor ? (
        <UncertaintyLegendOverlay />
      ) : null}

      {handleConfig?.kind === "axial" ||
      handleConfig?.kind === "heightStretch" ? (
        <SizingHandle
          baseWorld={handleConfig.baseWorld}
          axisWorld={handleConfig.axisWorld}
          length={handleConfig.length}
          value={manipulationValueOrZero}
          label={`${manipulationValueOrZero >= 0 ? "+" : ""}${(
            manipulationValueOrZero * 1000
          ).toFixed(1)} mm`}
          onChange={(value) => onManipulationChange?.(value)}
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

      {handleConfig?.kind === "angle" ? (
        <AngleHandle
          pivotWorld={handleConfig.pivotWorld}
          value={manipulationValueOrZero}
          label={`${
            manipulationValueOrZero >= 0 ? "+" : ""
          }${manipulationValueOrZero.toFixed(1)}°`}
          onChange={(value) => onManipulationChange?.(value)}
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

      {/* Angle tool: arc + θ label + drag handle between two selected parts */}
      {activeTool === "angle" && angleOverlayConfig ? (
        <AngleArcOverlay
          pivot={angleOverlayConfig.pivot}
          line1Dir={angleOverlayConfig.line1Dir}
          normalAxis={angleOverlayConfig.normalAxis}
          angleDeg={angleArcDeg}
          radius={angleOverlayConfig.radius}
          onDrag={setAngleArcDeg}
        />
      ) : null}

      {/* Angle tool: pivot vertex marker */}
      {activeTool === "angle" && angleVertex ? (
        <Html
          position={[
            angleVertex.point.x,
            angleVertex.point.y,
            angleVertex.point.z,
          ]}
          center
          distanceFactor={0.8}
          occlude={false}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#f59e0b",
              border: "2.5px solid white",
              boxShadow: "0 2px 8px rgba(245,158,11,0.6)",
              pointerEvents: "none",
              userSelect: "none",
            }}
          />
        </Html>
      ) : null}

      {/* Angle tool: selection markers showing which parts are chosen */}
      {activeTool === "angle" &&
        [
          { pathKey: angleFace1?.pathKey ?? null, label: "1", color: "#64748b" },
          { pathKey: angleFace2?.pathKey ?? null, label: "2", color: "#2b6cff" },
        ].map(({ pathKey, label, color }) => {
          if (!pathKey) return null;
          const summary = objectSummaries.find((s) => s.pathKey === pathKey);
          if (!summary) return null;
          const c = summary.aabbCenterWorld;
          const halfY = summary.aabbSizeWorld[1] / 2;
          const pos: [number, number, number] = [c[0], c[1] + halfY + 0.03, c[2]];
          return (
            <Html
              key={pathKey}
              position={pos}
              center
              distanceFactor={0.8}
              occlude={false}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: color,
                  border: "2px solid white",
                  boxShadow: `0 2px 8px ${color}88`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "Arial, sans-serif",
                  fontSize: 11,
                  fontWeight: 800,
                  color: "white",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              >
                {label}
              </div>
            </Html>
          );
        })}

      {/* Angle tool: step-by-step prompt */}
      {activeTool === "angle" ? (
        <Html fullscreen style={{ pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(255,255,255,0.93)",
              padding: "5px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "Arial, sans-serif",
              color: "#172033",
              fontWeight: 500,
              border: "1px solid rgba(43,108,255,0.3)",
              boxShadow: "0 4px 14px rgba(15,23,42,0.12)",
              whiteSpace: "nowrap",
            }}
          >
            {!angleVertex
              ? "Step 1/3 — Click a corner (vertex) to set the rotation pivot"
              : !angleFace1
                ? "Step 2/3 — Click a face on the part that stays fixed"
                : !angleFace2
                  ? "Step 3/3 — Click a face on a different part to rotate"
                  : "Drag the blue handle or edit θ in the panel, then Save mark"}
          </div>
        </Html>
      ) : null}
    </>
  );
}

export default function FuzzyCADGeometryViewer({
  gltfUrl,
  placements,
  highlightedPathKey,
  selectedPathKeys,
  activeTool = "select",
  confidenceAnnotations,
  confidenceEditor,
  activePathKeys,
  manipulationValue,
  rolePreviewPlan,
  confirmedHeightPlan,
  enableManipulationHandles = true,
  onMeshGraph,
  onObjectSummaries,
  onSelectedNode,
  onSelectedPathKey,
  onObjectLassoSelection,
  onManipulationChange,
  angleTargetDeg,
  angleMateEdges,
  angleResetNonce,
  onAngleSelection,
}: FuzzyCADGeometryViewerProps) {
  const [lassoPolygon, setLassoPolygon] = useState<ScreenPoint[] | null>(null);
  const [manipulationDragging, setManipulationDragging] = useState(false);

  function clearSelection() {
    onSelectedNode?.(null);
    onSelectedPathKey?.(null);
    onObjectLassoSelection?.([]);
    setLassoPolygon(null);
  }

  return (
    <div className={styles.root}>
      {!gltfUrl ? (
        <div className={styles.emptyState}>
          No geometry loaded yet. Click <strong>Load Assembly Geometry</strong>.
        </div>
      ) : (
        <>
          <Canvas
            camera={{ position: [2.5, 2.5, 2.5], fov: 45 }}
            gl={{ antialias: true }}
            onPointerMissed={(event) => {
              if (activeTool !== "select") {
                return;
              }

              if (event.button !== 0) {
                return;
              }

              clearSelection();
            }}
          >
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 6, 5]} intensity={1.2} />
            <gridHelper args={[2, 20]} />
            <axesHelper args={[0.25]} />

            <Suspense fallback={null}>
              <Bounds fit clip margin={1.2}>
                <Model
                  url={gltfUrl}
                  placements={placements}
                  highlightedPathKey={highlightedPathKey}
                  selectedPathKeys={selectedPathKeys}
                  activeTool={activeTool}
                  confidenceAnnotations={confidenceAnnotations}
                  confidenceEditor={confidenceEditor}
                  activePathKeys={activePathKeys}
                  manipulationValue={manipulationValue}
                  rolePreviewPlan={rolePreviewPlan}
                  confirmedHeightPlan={confirmedHeightPlan}
                  enableManipulationHandles={enableManipulationHandles}
                  lassoPolygon={lassoPolygon}
                  onMeshGraph={onMeshGraph}
                  onObjectSummaries={onObjectSummaries}
                  onSelectedNode={onSelectedNode}
                  onSelectedPathKey={onSelectedPathKey}
                  onObjectLassoSelection={onObjectLassoSelection}
                  onManipulationChange={onManipulationChange}
                  onManipulationDragStateChange={setManipulationDragging}
                  angleTargetDeg={angleTargetDeg}
                  angleMateEdges={angleMateEdges}
                  angleResetNonce={angleResetNonce}
                  onAngleSelection={onAngleSelection}
                />
              </Bounds>
            </Suspense>

            <OrbitControls
              makeDefault
              enabled={activeTool !== "lasso" && !manipulationDragging}
            />
          </Canvas>

          {activeTool === "lasso" ? (
            <LassoOverlay
              onComplete={(points) => {
                setLassoPolygon(points);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}