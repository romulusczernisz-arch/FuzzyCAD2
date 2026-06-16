"use client";

import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Bounds, OrbitControls, useGLTF } from "@react-three/drei";
import RoleBadge, { type RoleBadgeRole } from "./viewer/RoleBadge";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import styles from "./FuzzyCADGeometryViewer.module.css";
import { buildMeshGraph, type MeshGraphNode } from "./viewer/meshGraph";
import { findFuzzyPathKey } from "./viewer/selection";
import { applyPlacements, type PartPlacement } from "./viewer/placement";
import { applyPathHighlight } from "./viewer/highlight";
import { prepareRenderableMeshes } from "./viewer/materials";
import type { OperationTool } from "../lib/operations/types";
import LassoOverlay from "./viewer/LassoOverlay";
import {
  selectPathKeysByLasso,
  type ScreenPoint,
} from "./viewer/lassoObjectSelection";
import { buildObjectSummaries } from "./viewer/objectSummary";
import type { AxialStretchObjectSummary } from "../lib/operations/axialStretchTypes";
import {
  findObjectsByPathKeys,
  rotateObjectsAroundWorldAxis,
  translateObjectsWorld,
} from "./viewer/manipulation";
import SizingHandle from "./viewer/SizingHandle";
import AngleHandle from "./viewer/AngleHandle";
import {
  createAxialStretchSession,
  getAxialStretchSessionHandle,
  restoreAxialStretchSession,
  updateAxialStretchSession,
  type AxialStretchRolePlan,
  type AxialStretchSession,
} from "./viewer/axialStretchExecutor";

export type { MeshGraphNode } from "./viewer/meshGraph";
export type { PartPlacement, PlacementReport } from "./viewer/placement";
export type { AxialStretchObjectSummary } from "../lib/operations/axialStretchTypes";
export type RolePreviewPlan = {
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
  fixedAnchorPathKeys: string[];
  excludedPathKeys: string[];
};

type FuzzyCADGeometryViewerProps = {
  gltfUrl: string | null;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  activeTool?: OperationTool;
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
      session: AxialStretchSession;
    }
  | {
      kind: "angle";
      pivotWorld: THREE.Vector3;
      objects: THREE.Object3D[];
    }
  | null;


function midpoint(a: [number, number, number], b: [number, number, number]) {
  return [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ] as [number, number, number];
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

  return [
    anchor[0] + side * baseOffset,
    anchor[1] + verticalOffset,
    anchor[2],
  ];
}


function Model({
  url,
  placements,
  highlightedPathKey,
  selectedPathKeys,
  activeTool,
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
}: {
  url: string;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  activeTool?: OperationTool;
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

const heightStretchSession = useMemo(() => {
  if (!confirmedHeightPlan) {
    return null;
  }

  return createAxialStretchSession(
    scene,
    objectSummaries,
    confirmedHeightPlan,
  );
}, [scene, objectSummaries, confirmedHeightPlan]);

useEffect(() => {
  return () => {
    if (heightStretchSession) {
      restoreAxialStretchSession(heightStretchSession);
    }
  };
}, [heightStretchSession]);


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

  useEffect(() => {
    const activeHighlights =
      selectedPathKeys && selectedPathKeys.length > 0
        ? selectedPathKeys
        : highlightedPathKey;

    applyPathHighlight(scene, activeHighlights);
  }, [scene, highlightedPathKey, selectedPathKeys]);

  // --- Sizing / angle handle setup -------------------------------------

const handleConfig = useMemo<HandleConfig>(() => {
  if (!enableManipulationHandles) {
    return null;
  }

  if (
    activeTool === "height" &&
    confirmedHeightPlan &&
    heightStretchSession
  ) {
    const handle = getAxialStretchSessionHandle(heightStretchSession);

    return {
      kind: "heightStretch",
      baseWorld: handle.baseWorld,
      axisWorld: handle.axisWorld,
      length: handle.length,
      session: heightStretchSession,
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
      // World-up axis. Anchor the bar at the highest point of the
      // selection, base at the lowest, so dragging up/down raises or
      // lowers the selection along the assembly's height direction.
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
      // Extend along the selected object's own principal axis, from its
      // negative end toward its positive end.
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

    // activeTool === "angle"
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
  heightStretchSession,
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

  const appliedValueRef = useRef(0);
  const angleAxisRef = useRef(new THREE.Vector3(0, 0, 1));

  // Reset the "already applied" tracker whenever the handle target changes
  // (new selection/tool). Geometry already nudged for a prior selection
  // stays as-is; the new selection starts from its current pose.
  useEffect(() => {
    appliedValueRef.current = 0;
  }, [handleConfig]);

  // Apply the delta between the new manipulation value and what's already
  // been applied to the matched objects.
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
  updateAxialStretchSession(handleConfig.session, targetValue);
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

      {handleConfig?.kind === "axial" || handleConfig?.kind === "heightStretch" ? (
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
    </>
  );
}

export default function FuzzyCADGeometryViewer({
  gltfUrl,
  placements,
  highlightedPathKey,
  selectedPathKeys,
  activeTool = "select",
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
            <directionalLight position={[5, 6, 5]} intensity={1.2}  />
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
