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
  modelPosition: {
    x: number;
    y: number;
    z: number;
  };
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
  if (!material) {
    return null;
  }

  if (Array.isArray(material)) {
    return material.map((item) => item.name || item.type).join(", ");
  }

  return material.name || material.type;
}

export function buildMeshGraph(scene: THREE.Object3D): MeshGraphNode[] {
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