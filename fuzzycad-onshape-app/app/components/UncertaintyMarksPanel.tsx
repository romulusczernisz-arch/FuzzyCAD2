"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AngleUncertaintyAnnotation,
  FuzzyCADUncertaintyAnnotation,
  FuzzyCADUncertaintyDocument,
  SizeUncertaintyAnnotation,
} from "../lib/uncertainty/document";
import styles from "./UncertaintyMarksPanel.module.css";

type PendingAngle = {
  part1PathKey: string;
  part2PathKey: string;
  angleDeg: number;
};

type UncertaintyMarksPanelProps = {
  document: FuzzyCADUncertaintyDocument;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (annotationId: string | null) => void;
  onEditSizeAnnotation: (annotation: SizeUncertaintyAnnotation) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onCommentChange: (annotationId: string, comment: string) => void;
  onSaveToOnshape: () => void;
  pendingAngle?: PendingAngle | null;
  pendingAngleComment?: string;
  onPendingAngleCommentChange?: (comment: string) => void;
  /** Called when the user edits the angle value directly in the input field. */
  onPendingAngleValueChange?: (angleDeg: number) => void;
  onSaveAngle?: () => void;
  onCancelAngle?: () => void;
};

function getAnnotationTitle(annotation: FuzzyCADUncertaintyAnnotation) {
  if (annotation.type === "size") return "Size uncertainty";
  if (annotation.type === "angle") return "Angle uncertainty";
  return "Uncertainty";
}

function getMarkCountLabel(count: number) {
  if (count === 0) {
    return "No marks yet";
  }

  return `${count} mark${count === 1 ? "" : "s"}`;
}

function SizeAnnotationCard({
  annotation,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onCommentChange,
}: {
  annotation: SizeUncertaintyAnnotation;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCommentChange: (comment: string) => void;
}) {
  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <div
          className={`${styles.cardTitle} ${
            selected ? styles.cardTitleSelected : ""
          }`}
        >
          {getAnnotationTitle(annotation)}
        </div>

        <div
          className={`${styles.scopeBadge} ${
            selected ? styles.scopeBadgeSelected : ""
          }`}
        >
          {annotation.target.scope}
        </div>
      </div>

      <textarea
        className={styles.comment}
        value={annotation.comment ?? ""}
        placeholder="Add a comment..."
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.editButton}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          Edit
        </button>

        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function AngleAnnotationCard({
  annotation,
  selected,
  onSelect,
  onDelete,
  onCommentChange,
}: {
  annotation: AngleUncertaintyAnnotation;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onCommentChange: (comment: string) => void;
}) {
  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <div
          className={`${styles.cardTitle} ${
            selected ? styles.cardTitleSelected : ""
          }`}
        >
          {getAnnotationTitle(annotation)}
        </div>

        <div
          className={`${styles.scopeBadge} ${
            selected ? styles.scopeBadgeSelected : ""
          }`}
        >
          θ = {Math.abs(annotation.angleDeg).toFixed(1)}°
        </div>
      </div>

      <textarea
        className={styles.comment}
        value={annotation.comment ?? ""}
        placeholder="Add a comment..."
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

/**
 * Isolated sub-component so it can hold local draft state for the angle input.
 * Using local state prevents the controlled-input / toFixed reformat problem
 * where every keystroke resets the field, making it impossible to type.
 */
function PendingAnglePanel({
  pendingAngle,
  pendingAngleComment = "",
  onPendingAngleValueChange,
  onPendingAngleCommentChange,
  onSaveAngle,
  onCancelAngle,
}: {
  pendingAngle: PendingAngle;
  pendingAngleComment?: string;
  onPendingAngleValueChange?: (angleDeg: number) => void;
  onPendingAngleCommentChange?: (comment: string) => void;
  onSaveAngle?: () => void;
  onCancelAngle?: () => void;
}) {
  // Local draft keeps what the user is currently typing.
  const [draft, setDraft] = useState(pendingAngle.angleDeg.toFixed(1));

  // Track the last externally-set angleDeg so we can sync when arc drag updates it.
  const lastExternalDeg = useRef(pendingAngle.angleDeg);
  useEffect(() => {
    if (pendingAngle.angleDeg !== lastExternalDeg.current) {
      lastExternalDeg.current = pendingAngle.angleDeg;
      setDraft(pendingAngle.angleDeg.toFixed(1));
    }
  }, [pendingAngle.angleDeg]);

  return (
    <div className={styles.pendingAngle}>
      <div className={styles.pendingAngleHeader}>
        <span className={styles.pendingAngleLabel}>Angle uncertainty</span>
      </div>
      <div className={styles.pendingAngleRow}>
        <span className={styles.pendingAngleSymbol}>θ =</span>
        <input
          type="number"
          className={styles.pendingAngleInput}
          value={draft}
          min={0}
          max={179}
          step={0.5}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) {
              const clamped = Math.max(0, Math.min(179, v));
              lastExternalDeg.current = clamped;
              onPendingAngleValueChange?.(clamped);
            }
          }}
          onBlur={() => {
            // Clean up display on blur
            const v = parseFloat(draft);
            const clamped = isNaN(v) ? pendingAngle.angleDeg : Math.max(0, Math.min(179, v));
            setDraft(clamped.toFixed(1));
          }}
        />
        <span className={styles.pendingAngleDeg}>°</span>
      </div>
      <textarea
        className={styles.comment}
        value={pendingAngleComment}
        placeholder="Add a comment..."
        onChange={(e) => onPendingAngleCommentChange?.(e.target.value)}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.editButton} onClick={onSaveAngle}>
          Save mark
        </button>
        <button type="button" className={styles.deleteButton} onClick={onCancelAngle}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function UncertaintyMarksPanel({
  document,
  selectedAnnotationId,
  onSelectAnnotation,
  onEditSizeAnnotation,
  onDeleteAnnotation,
  onCommentChange,
  onSaveToOnshape,
  pendingAngle,
  pendingAngleComment = "",
  onPendingAngleCommentChange,
  onPendingAngleValueChange,
  onSaveAngle,
  onCancelAngle,
}: UncertaintyMarksPanelProps) {
  const annotations = document.annotations;

  return (
    <aside className={styles.panel}>
      <div className={styles.content}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Uncertainty marks</div>
            <div className={styles.subtitle}>
              {getMarkCountLabel(annotations.length)}
            </div>
          </div>

          {selectedAnnotationId ? (
            <button
              type="button"
              className={styles.showAllButton}
              onClick={() => onSelectAnnotation(null)}
            >
              Show all
            </button>
          ) : null}
        </div>

        <div className={styles.syncActions}>
          <button
            type="button"
            className={styles.syncButton}
            onClick={onSaveToOnshape}
          >
            Save to Onshape
          </button>
        </div>

        {pendingAngle ? (
          <PendingAnglePanel
            pendingAngle={pendingAngle}
            pendingAngleComment={pendingAngleComment}
            onPendingAngleValueChange={onPendingAngleValueChange}
            onPendingAngleCommentChange={onPendingAngleCommentChange}
            onSaveAngle={onSaveAngle}
            onCancelAngle={onCancelAngle}
          />
        ) : null}

        {annotations.length === 0 && !pendingAngle ? (
          <div className={styles.emptyState}>
            Use the Size or Angle tools to add an uncertainty mark. Each mark
            will appear here as a card.
          </div>
        ) : null}

        <div className={styles.cardList}>
          {annotations.map((annotation) => {
            const selected = annotation.id === selectedAnnotationId;

            if (annotation.type === "size") {
              return (
                <SizeAnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  selected={selected}
                  onSelect={() => onSelectAnnotation(annotation.id)}
                  onEdit={() => onEditSizeAnnotation(annotation)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                  onCommentChange={(comment) =>
                    onCommentChange(annotation.id, comment)
                  }
                />
              );
            }

            if (annotation.type === "angle") {
              return (
                <AngleAnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  selected={selected}
                  onSelect={() => onSelectAnnotation(annotation.id)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                  onCommentChange={(comment) =>
                    onCommentChange(annotation.id, comment)
                  }
                />
              );
            }

            return null;
          })}
        </div>
      </div>
    </aside>
  );
}
