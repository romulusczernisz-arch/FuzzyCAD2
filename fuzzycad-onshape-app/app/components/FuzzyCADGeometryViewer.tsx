"use client";

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type PartPlacement = {
  partName: string | null;
  transform: number[]; // Onshape 4x4 行主序，绝对（装配空间）
};

function normName(s: string | null | undefined): string {
  return (s || "")
    .replace(/\s*<\s*\d+\s*>\s*$/, "")
    .replace(/_\d+$/, "")
    .trim()
    .toLowerCase();
}

function isAncestor(anc: THREE.Object3D, node: THREE.Object3D): boolean {
  let p = node.parent;
  while (p) {
    if (p === anc) return true;
    p = p.parent;
  }
  return false;
}

function collectPartGroups(scene: THREE.Object3D): THREE.Object3D[] {
  const groups: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o === scene || o instanceof THREE.Mesh) return;
    if (!o.name || o.name === "Scene") return;
    let hasMesh = false;
    o.traverse((c) => {
      if (c instanceof THREE.Mesh) hasMesh = true;
    });
    if (hasMesh) groups.push(o);
  });
  return groups.filter(
    (g) => !groups.some((other) => other !== g && isAncestor(other, g))
  );
}

function placeGroup(
  g: THREE.Object3D,
  transform: number[],
  sceneInv: THREE.Matrix4
) {
  const occ = new THREE.Matrix4();
  occ.set(
    transform[0], transform[1], transform[2], transform[3],
    transform[4], transform[5], transform[6], transform[7],
    transform[8], transform[9], transform[10], transform[11],
    transform[12], transform[13], transform[14], transform[15]
  );
  const parent = g.parent ?? g;
  const parentRel = sceneInv.clone().multiply(parent.matrixWorld);
  const local = parentRel.invert().multiply(occ);
  local.decompose(g.position, g.quaternion, g.scale);
  g.matrixWorldNeedsUpdate = true;
}

function applyPlacements(scene: THREE.Object3D, placements: PartPlacement[]) {
  if (!placements || placements.length === 0) return;
  scene.updateMatrixWorld(true);

  const groups = collectPartGroups(scene);

  const byName = new Map<string, number[][]>();
  for (const p of placements) {
    const k = normName(p.partName);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(p.transform);
  }

  const sceneInv = scene.matrixWorld.clone().invert();
  const cursor = new Map<string, number>();
  const unmatched: THREE.Object3D[] = [];
  let placedByName = 0;

  for (const g of groups) {
    const k = normName(g.name);
    const list = byName.get(k);
    const i = cursor.get(k) ?? 0;
    if (!list || i >= list.length) {
      unmatched.push(g);
      continue;
    }
    cursor.set(k, i + 1);
    placeGroup(g, list[i], sceneInv);
    placedByName++;
  }

  // 兜底：名字没对上的，按顺序配剩下的 transform
  if (unmatched.length > 0) {
    const leftovers: number[][] = [];
    for (const [k, list] of byName) {
      const used = cursor.get(k) ?? 0;
      for (let i = used; i < list.length; i++) leftovers.push(list[i]);
    }
    for (let i = 0; i < unmatched.length && i < leftovers.length; i++) {
      placeGroup(unmatched[i], leftovers[i], sceneInv);
    }
    console.warn(
      `[FuzzyCAD] placement: 按名字摆了 ${placedByName}/${groups.length}，` +
        `按顺序兜底 ${Math.min(unmatched.length, leftovers.length)}。` +
        `组名: [${groups.map((g) => g.name).join(", ")}]`
    );
  } else {
    console.log(`[FuzzyCAD] placement: 全部按名字摆好 ${placedByName}/${groups.length}`);
  }
}

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
  placements?: PartPlacement[];
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
  placements,
  onMeshGraph,
  onSelectedNode,
}: {
  url: string;
  placements?: PartPlacement[];
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
    return cloned;
  }, [gltf.scene, placements]);

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
  placements,
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
                  placements={placements}
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