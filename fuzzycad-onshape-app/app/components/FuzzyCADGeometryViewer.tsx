"use client";

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import styles from "./FuzzyCADGeometryViewer.module.css";
import { buildMeshGraph, type MeshGraphNode } from "./viewer/meshGraph";
import { findFuzzyPathKey } from "./viewer/selection";
import { applyPlacements, type PartPlacement } from "./viewer/placement";

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

    cloned.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material = object.material.map((material) => {
              const m = material.clone();
              m.side = THREE.DoubleSide;
              return m;
            });
          } else {
            const m = object.material.clone();
            m.side = THREE.DoubleSide;
            object.material = m;
          }
        }
      }
    });

    applyPlacements(cloned, placements ?? []);
    cloned.rotation.x = -Math.PI / 2; // Onshape Z-up -> three.js Y-up
    return cloned;
  }, [gltf.scene, placements]);

  useEffect(() => {
    const graph = buildMeshGraph(scene);
    graphRef.current = graph;
    onMeshGraph?.(graph);
    onSelectedNode?.(null);
  }, [scene, onMeshGraph, onSelectedNode]);

  // 点树 -> 高亮对应零件（改 emissive，可逆，不破坏原材质）
  useEffect(() => {
    const applyEmissive = (
      root: THREE.Object3D,
      hex: number | null,
      intensity: number,
    ) => {
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const mm = m as THREE.MeshStandardMaterial;
          if (!mm || !mm.emissive) continue;
          if (mm.userData.fuzzyOrigEmissive === undefined) {
            mm.userData.fuzzyOrigEmissive = mm.emissive.getHex();
            mm.userData.fuzzyOrigEmissiveIntensity = mm.emissiveIntensity ?? 1;
          }
          if (hex === null) {
            mm.emissive.setHex(mm.userData.fuzzyOrigEmissive as number);
            mm.emissiveIntensity = mm.userData
              .fuzzyOrigEmissiveIntensity as number;
          } else {
            mm.emissive.setHex(hex);
            mm.emissiveIntensity = intensity;
          }
        }
      });
    };

    applyEmissive(scene, null, 1); // 先全部恢复
    if (!highlightedPathKey) return;

    const targets: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.userData && o.userData.fuzzyPathKey === highlightedPathKey) {
        targets.push(o);
      }
    });
    for (const t of targets) applyEmissive(t, 0x2b6cff, 0.7);
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
