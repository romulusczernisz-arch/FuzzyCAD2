"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";

/** Pixels of horizontal drag that equal 1 mm of change (0.001 m). */
const PX_PER_MM = 1.5;
const TRACK_WIDTH = 220;
const TRACK_HALF = TRACK_WIDTH / 2;

type SizingHandleProps = {
  baseWorld: THREE.Vector3;
  axisWorld: THREE.Vector3;
  length: number;
  value: number;
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
  const [dragging, setDragging] = useState(false);

  // Blue axis line grows/shrinks with the current value.
  const tipWorld = baseWorld
    .clone()
    .add(axisWorld.clone().multiplyScalar(length + value));

  // Knob pixel offset from track centre; clamp to track bounds for display.
  const valueInMm = value * 1000;
  const knobLeft = Math.max(
    0,
    Math.min(TRACK_WIDTH, TRACK_HALF + valueInMm * PX_PER_MM),
  );

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const startX = event.clientX;
    const startValue = value;

    const onMove = (e: PointerEvent) => {
      const deltaMm = (e.clientX - startX) / PX_PER_MM;
      onChange(startValue + deltaMm * 0.001);
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
          className={`${styles.sizingHandle} ${dragging ? styles.sizingHandleActive : ""}`}
          onPointerDown={handlePointerDown}
        >
          <div className={styles.sizingHandleTrack}>
            <div
              className={styles.sizingHandleKnob}
              style={{ left: `${knobLeft}px` }}
            />
          </div>
          <div className={styles.sizingHandleLabel}>{label}</div>
        </div>
      </Html>
    </group>
  );
}
