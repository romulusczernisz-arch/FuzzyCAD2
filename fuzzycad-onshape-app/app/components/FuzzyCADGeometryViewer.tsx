"use client";

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type MeshGraphNode = {
  nodeId: string;
  name: string;
  type: string;
  parentId: string | null;
  parentName: string | null;
  childCount: number;
  children: string[];
  path: string;
  visible: boolean;

  isMesh: boolean;
  geometryName: string | null;
  materialName: string | null;
  vertexCount: number | null;
  triangleCount: number | null;

  localMatrix: number[];
  worldMatrix: number[];
  worldPosition: {
    x: number;
    y: number;
    z: number;
  };
  modelMatrix: number[];
  modelPosition: { x: number; y: number; z: number };
};

type FuzzyCADGeometryViewerProps = {
  gltfUrl: string | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
};

function getObjectPath(object: THREE.Object3D): string {
  const names: string[] = [];
  let current: THREE.Object3D | null = object;

  while (current) {
    const label = current.name || current.type || "Unnamed";
    names.unshift(label);
    current = current.parent;
  }

  return names.join(" / ");
}

function getMaterialName(material: THREE.Material | THREE.Material[] | null) {
  if (!material) return null;

  if (Array.isArray(material)) {
    return material.map((item) => item.name || item.type).join(", ");
  }

  return material.name || material.type;
}

function buildMeshGraph(scene: THREE.Object3D): MeshGraphNode[] {
  scene.updateMatrixWorld(true);
  const sceneInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();

  const nodes: MeshGraphNode[] = [];

  scene.traverse((object) => {
    const isMesh = object instanceof THREE.Mesh;

    let geometryName: string | null = null;
    let materialName: string | null = null;
    let vertexCount: number | null = null;
    let triangleCount: number | null = null;

    if (isMesh) {
      geometryName = object.geometry.name || null;
      materialName = getMaterialName(object.material);

      const position = object.geometry.attributes.position;
      vertexCount = position ? position.count : null;

      if (object.geometry.index) {
        triangleCount = object.geometry.index.count / 3;
      } else if (position) {
        triangleCount = position.count / 3;
      }
    }

    const worldPosition = new THREE.Vector3();
    worldPosition.setFromMatrixPosition(object.matrixWorld);

    const modelMatrix = new THREE.Matrix4().multiplyMatrices(
      sceneInverse,
      object.matrixWorld
    );
    const modelPosition = new THREE.Vector3().setFromMatrixPosition(modelMatrix);

    nodes.push({
      nodeId: object.uuid,
      name: object.name || "",
      type: object.type,
      parentId: object.parent?.uuid ?? null,
      parentName: object.parent?.name || object.parent?.type || null,
      childCount: object.children.length,
      children: object.children.map((child) => child.uuid),
      path: getObjectPath(object),
      visible: object.visible,

      isMesh,
      geometryName,
      materialName,
      vertexCount,
      triangleCount,

      localMatrix: object.matrix.toArray(),
      worldMatrix: object.matrixWorld.toArray(),
    worldPosition: {
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
      },
      modelMatrix: modelMatrix.toArray(),
      modelPosition: {
        x: modelPosition.x,
        y: modelPosition.y,
        z: modelPosition.z,
      },
    });
  });

  return nodes;
}

function Model({
  url,
  onMeshGraph,
  onSelectedNode,
}: {
  url: string;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
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
              const clonedMaterial = material.clone();
              clonedMaterial.side = THREE.DoubleSide;
              return clonedMaterial;
            });
          } else {
            const clonedMaterial = object.material.clone();
            clonedMaterial.side = THREE.DoubleSide;
            object.material = clonedMaterial;
          }
        }
      }
    });

    return cloned;
  }, [gltf.scene]);

  useEffect(() => {
    const graph = buildMeshGraph(scene);
    graphRef.current = graph;
    onMeshGraph?.(graph);
    onSelectedNode?.(null);
  }, [scene, onMeshGraph, onSelectedNode]);

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();

    const selectedObject = event.object;
    const graph = graphRef.current;

    const selectedNode =
      graph.find((node) => node.nodeId === selectedObject.uuid) ?? null;

    onSelectedNode?.(selectedNode);
  }

  return <primitive object={scene} onPointerDown={handlePointerDown} />;
}

export default function FuzzyCADGeometryViewer({
  gltfUrl,
  onMeshGraph,
  onSelectedNode,
}: FuzzyCADGeometryViewerProps) {
  return (
    <div
      style={{
        width: "100%",
        height: 560,
        border: "1px solid #ccc",
        borderRadius: 8,
        overflow: "hidden",
        background: "#f6f7f8",
      }}
    >
      {!gltfUrl ? (
        <div style={{ padding: 16 }}>
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
                  onMeshGraph={onMeshGraph}
                  onSelectedNode={onSelectedNode}
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