"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import styles from "../FuzzyCADGeometryViewer.module.css";
import { projectToScreen } from "./manipulation";

const RADIUS_PX = 64;

type AngleHandleProps = {
  /** World-space pivot point the rotation happens around. */
  pivotWorld: THREE.Vector3;
  /** Current rotation offset, in degrees. */
  value: number;
  /** Formatted text shown on the handle, e.g. "+12.5°". */
  label: string;
  onChange: (degrees: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

export default function AngleHandle({
  pivotWorld,
  value,
  label,
  onChange,
  onDragStateChange,
}: AngleHandleProps) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);

  // Knob sits on a circle of radius RADIUS_PX, offset from "straight up" by
  // the current value (in degrees).
  const angleRad = ((value - 90) * Math.PI) / 180;
  const knobX = Math.cos(angleRad) * RADIUS_PX;
  const knobY = Math.sin(angleRad) * RADIUS_PX;

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const rect = gl.domElement.getBoundingClientRect();
    const pivotScreen = projectToScreen(pivotWorld, camera, rect);

    if (!pivotScreen) {
      return;
    }

    const pivotClientX = rect.left + pivotScreen.x;
    const pivotClientY = rect.top + pivotScreen.y;

    const startAngle = Math.atan2(
      event.clientY - pivotClientY,
      event.clientX - pivotClientX,
    );
    const startValue = value;

    const onMove = (moveEvent: PointerEvent) => {
      const angle = Math.atan2(
        moveEvent.clientY - pivotClientY,
        moveEvent.clientX - pivotClientX,
      );
      const deltaDeg = ((angle - startAngle) * 180) / Math.PI;

      onChange(startValue + deltaDeg);
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
    <Html position={pivotWorld} center zIndexRange={[100, 0]}>
      <div className={styles.angleHandleRoot}>
        <div
          className={styles.angleHandleCircle}
          style={{ width: RADIUS_PX * 2, height: RADIUS_PX * 2 }}
        />
        <div
          className={`${styles.angleHandleKnob} ${
            dragging ? styles.angleHandleKnobActive : ""
          }`}
          style={{ transform: `translate(${knobX}px, ${knobY}px)` }}
          onPointerDown={handlePointerDown}
        />
        <div className={styles.angleHandleLabel}>{label}</div>
      </div>
    </Html>
  );
}
