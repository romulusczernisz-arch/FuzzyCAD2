"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import styles from "../FuzzyCADGeometryViewer.module.css";
import { projectToScreen } from "./manipulation";

type SizingHandleProps = {
  /** World-space point the bar is drawn from (does not move while dragging). */
  baseWorld: THREE.Vector3;
  /** Normalized world-space direction the bar extends along. */
  axisWorld: THREE.Vector3;
  /** Reference length along the axis, before `value` is applied. */
  length: number;
  /** Current signed offset along the axis, in world units. */
  value: number;
  /** Formatted text shown on the handle, e.g. "+24.0 mm". */
  label: string;
  onChange: (value: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

export default function SizingHandle({
  baseWorld,
  axisWorld,
  length,
  value,
  label,
  onChange,
  onDragStateChange,
}: SizingHandleProps) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);

  const tipWorld = baseWorld
    .clone()
    .add(axisWorld.clone().multiplyScalar(length + value));

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const rect = gl.domElement.getBoundingClientRect();
    const p0 = projectToScreen(baseWorld, camera, rect);
    const p1 = projectToScreen(baseWorld.clone().add(axisWorld), camera, rect);

    if (!p0 || !p1) {
      return;
    }

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const pixelsPerUnit = Math.hypot(dx, dy) || 1;
    const screenDir = { x: dx / pixelsPerUnit, y: dy / pixelsPerUnit };

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startValue = value;

    const onMove = (moveEvent: PointerEvent) => {
      const moveDx = moveEvent.clientX - startClientX;
      const moveDy = moveEvent.clientY - startClientY;
      const screenDelta = moveDx * screenDir.x + moveDy * screenDir.y;

      onChange(startValue + screenDelta / pixelsPerUnit);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      onDragStateChange?.(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    setDragging(true);
    onDragStateChange?.(true);
  }

  return (
    <group>
      <Line points={[baseWorld, tipWorld]} color="#2b6cff" lineWidth={2} />
      <Html position={tipWorld} center zIndexRange={[100, 0]}>
        <div
          className={`${styles.sizingHandle} ${
            dragging ? styles.sizingHandleActive : ""
          }`}
          onPointerDown={handlePointerDown}
        >
          <div className={styles.sizingHandleKnob} />
          <div className={styles.sizingHandleLabel}>{label}</div>
        </div>
      </Html>
    </group>
  );
}
