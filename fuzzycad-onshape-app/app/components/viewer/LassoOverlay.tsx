"use client";

import { useState } from "react";
import styles from "../FuzzyCADGeometryViewer.module.css";
import type { ScreenPoint } from "./lassoObjectSelection";

type LassoOverlayProps = {
  onComplete: (points: ScreenPoint[]) => void;
};

export default function LassoOverlay({ onComplete }: LassoOverlayProps) {
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<ScreenPoint[]>([]);

  function getLocalPoint(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  const path =
    points.length > 0
      ? points
          .map((point, index) =>
            index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`,
          )
          .join(" ")
      : "";

  return (
    <div
      className={styles.lassoOverlay}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = getLocalPoint(event);

        setDrawing(true);
        setPoints([point]);
      }}
      onPointerMove={(event) => {
        if (!drawing) {
          return;
        }

        const point = getLocalPoint(event);

        setPoints((current) => {
          const last = current[current.length - 1];

          if (last) {
            const dx = point.x - last.x;
            const dy = point.y - last.y;

            if (dx * dx + dy * dy < 4) {
              return current;
            }
          }

          return [...current, point];
        });
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        const finalPoints = [...points, getLocalPoint(event)];

        setDrawing(false);

        if (finalPoints.length >= 3) {
          onComplete(finalPoints);
        }

        setPoints([]);
      }}
    >
      <svg className={styles.lassoSvg}>
        {path ? (
          <>
            <path d={`${path} Z`} className={styles.lassoFill} />
            <path d={path} className={styles.lassoStroke} />
          </>
        ) : null}
      </svg>
    </div>
  );
}