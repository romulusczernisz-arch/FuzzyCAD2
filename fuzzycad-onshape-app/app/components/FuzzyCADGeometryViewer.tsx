"use client";

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import styles from "./FuzzyCADGeometryViewer.module.css";
import { buildMeshGraph, type MeshGraphNode } from "./viewer/meshGraph";
import { findFuzzyPathKey } from "./viewer/selection";
import { applyPlacements, type PartPlacement } from "./viewer/placement";
import { applyPathHighlight } from "./viewer/highlight";
import { prepareRenderableMeshes } from "./viewer/materials";

export type { MeshGraphNode } from "./viewer/meshGraph";
export type { PartPlacement, PlacementReport } from "./viewer/placement";



type FuzzyCADGeometryViewerProps = {
  gltfUrl: string | null;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
};

function Model({
  url,
  placements,
  highlightedPathKey,
  onMeshGraph,
  onSelectedNode,
  onSelectedPathKey,
}: {
  url: string;
  placements?: PartPlacement[];
  highlightedPathKey?: string | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
}) {
  const gltf = useGLTF(url);
  const graphRef = useRef<MeshGraphNode[]>([]);

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
  applyPathHighlight(scene, highlightedPathKey);
}, [scene, highlightedPathKey]);

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
  onMeshGraph,
  onSelectedNode,
  onSelectedPathKey,
}: FuzzyCADGeometryViewerProps) {
  return (
    <div className={styles.root}>
      {!gltfUrl ? (
        <div className={styles.emptyState}>
          No geometry loaded yet. Click <strong>Load Assembly Geometry</strong>.
        </div>
      ) : (
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
                  onMeshGraph={onMeshGraph}
                  onSelectedNode={onSelectedNode}
                  onSelectedPathKey={onSelectedPathKey}
                />
              </Center>
            </Bounds>
          </Suspense>

          <OrbitControls makeDefault />
        </Canvas>
      )}
    </div>
  );
}
