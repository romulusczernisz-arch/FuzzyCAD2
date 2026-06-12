"use client";

import { Canvas } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";

type FuzzyCADGeometryViewerProps = {
  gltfUrl: string | null;
};

function Model({ url }: { url: string }) {
  const gltf = useGLTF(url);

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true);

    cloned.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;

        if (object.material) {
          const material = object.material;

          if (Array.isArray(material)) {
            material.forEach((m) => {
              m.side = THREE.DoubleSide;
            });
          } else {
            material.side = THREE.DoubleSide;
          }
        }
      }
    });

    return cloned;
  }, [gltf.scene]);

  return <primitive object={scene} />;
}

export default function FuzzyCADGeometryViewer({
  gltfUrl,
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
                <Model url={gltfUrl} />
              </Center>
            </Bounds>
          </Suspense>

          <OrbitControls makeDefault />
        </Canvas>
      )}
    </div>
  );
}