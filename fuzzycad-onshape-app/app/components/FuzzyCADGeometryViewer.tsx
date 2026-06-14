"use client";

import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

export type { MeshGraphNode } from "./viewer/meshGraph";
export type { PartPlacement, PlacementReport } from "./viewer/placement";



type FuzzyCADGeometryViewerProps = {
  gltfUrl: string | null;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  activeTool?: OperationTool;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
  onObjectLassoSelection?: (pathKeys: string[]) => void;
};

function Model({
  url,
  placements,
  highlightedPathKey,
  selectedPathKeys,
  lassoPolygon,
  onMeshGraph,
  onSelectedNode,
  onSelectedPathKey,
  onObjectLassoSelection,
}: {
  url: string;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  lassoPolygon?: ScreenPoint[] | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
  onObjectLassoSelection?: (pathKeys: string[]) => void;
}) {
  const gltf = useGLTF(url);
  const graphRef = useRef<MeshGraphNode[]>([]);
  const { camera, gl } = useThree();

  const scene = useMemo(() => {
  const cloned = gltf.scene.clone(true);

  prepareRenderableMeshes(cloned);
  applyPlacements(cloned, placements ?? []);
  cloned.rotation.x = -Math.PI / 2;

  return cloned;
}, [gltf.scene, placements]);

  useEffect(() => {
    const graph = buildMeshGraph(scene);
    graphRef.current = graph;
    onMeshGraph?.(graph);
    onSelectedNode?.(null);
  }, [scene, onMeshGraph, onSelectedNode]);

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

  return <primitive object={scene} onPointerDown={handlePointerDown} />;
}

export default function FuzzyCADGeometryViewer({
  gltfUrl,
  placements,
  highlightedPathKey,
  selectedPathKeys,
  activeTool = "select",
  onMeshGraph,
  onSelectedNode,
  onSelectedPathKey,
  onObjectLassoSelection,
}: FuzzyCADGeometryViewerProps) {
  const [lassoPolygon, setLassoPolygon] = useState<ScreenPoint[] | null>(null);
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
      shadows
      gl={{ antialias: true }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 6, 5]} intensity={1.2} castShadow />
      <gridHelper args={[2, 20]} />
      <axesHelper args={[0.25]} />

      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.2}>
          <Center>
            <Model
              url={gltfUrl}
              placements={placements}
              highlightedPathKey={highlightedPathKey}
              selectedPathKeys={selectedPathKeys}
              lassoPolygon={lassoPolygon}
              onMeshGraph={onMeshGraph}
              onSelectedNode={onSelectedNode}
              onSelectedPathKey={onSelectedPathKey}
              onObjectLassoSelection={onObjectLassoSelection}
            />
          </Center>
        </Bounds>
      </Suspense>

<OrbitControls makeDefault enabled={activeTool !== "lasso"} />
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
