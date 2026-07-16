"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AngleUncertaintyAnnotation,
  BendUncertaintyAnnotation,
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

type PendingBend = {
  pathKey: string;
  deltaDeg: number;
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
  pendingBend?: PendingBend | null;
  pendingBendComment?: string;
  onPendingBendCommentChange?: (comment: string) => void;
  onPendingBendValueChange?: (deltaDeg: number) => void;
  onSaveBend?: () => void;
  onCancelBend?: () => void;
};

function getAnnotationTitle(annotation: FuzzyCADUncertaintyAnnotation) {
  if (annotation.type === "size") return "Size uncertainty";
  if (annotation.type === "angle") return "Angle uncertainty";
  if (annotation.type === "bend") return "Bend uncertainty";
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
 * Shared pending-mark editor for value-based tools (angle θ, bend Δ).
 *
 * Isolated sub-component so it can hold local draft state for the numeric
 * input. Using local state prevents the controlled-input / toFixed reformat
 * problem where every keystroke resets the field, making it impossible to
 * type.
 */
function PendingValuePanel({
  title,
  symbol,
  value,
  min,
  max,
  comment = "",
  onValueChange,
  onCommentChange,
  onSave,
  onCancel,
}: {
  title: string;
  symbol: string;
  value: number;
  min: number;
  max: number;
  comment?: string;
  onValueChange?: (value: number) => void;
  onCommentChange?: (comment: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
}) {
  // Local draft keeps what the user is currently typing.
  const [draft, setDraft] = useState(value.toFixed(1));

  // Track the last externally-set value so we can sync when a viewer drag updates it.
  const lastExternal = useRef(value);
  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      setDraft(value.toFixed(1));
    }
  }, [value]);

  return (
    <div className={styles.pendingAngle}>
      <div className={styles.pendingAngleHeader}>
        <span className={styles.pendingAngleLabel}>{title}</span>
      </div>
      <div className={styles.pendingAngleRow}>
        <span className={styles.pendingAngleSymbol}>{symbol}</span>
        <input
          type="number"
          className={styles.pendingAngleInput}
          value={draft}
          min={min}
          max={max}
          step={0.5}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = parseFloat(e.target.value);
            if (!isNaN(parsed)) {
              const clamped = Math.max(min, Math.min(max, parsed));
              lastExternal.current = clamped;
              onValueChange?.(clamped);
            }
          }}
          onBlur={() => {
            // Clean up display on blur
            const parsed = parseFloat(draft);
            const clamped = isNaN(parsed)
              ? value
              : Math.max(min, Math.min(max, parsed));
            setDraft(clamped.toFixed(1));
          }}
        />
        <span className={styles.pendingAngleDeg}>°</span>
      </div>
      <textarea
        className={styles.comment}
        value={comment}
        placeholder="Add a comment..."
        onChange={(e) => onCommentChange?.(e.target.value)}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.editButton} onClick={onSave}>
          Save mark
        </button>
        <button type="button" className={styles.deleteButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function BendAnnotationCard({
  annotation,
  selected,
  onSelect,
  onDelete,
  onCommentChange,
}: {
  annotation: BendUncertaintyAnnotation;
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
          Δ = {annotation.deltaDeg >= 0 ? "+" : ""}
          {annotation.deltaDeg.toFixed(1)}°
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
  pendingBend,
  pendingBendComment = "",
  onPendingBendCommentChange,
  onPendingBendValueChange,
  onSaveBend,
  onCancelBend,
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
          <PendingValuePanel
            title="Angle uncertainty"
            symbol="θ ="
            value={pendingAngle.angleDeg}
            min={0}
            max={179}
            comment={pendingAngleComment}
            onValueChange={onPendingAngleValueChange}
            onCommentChange={onPendingAngleCommentChange}
            onSave={onSaveAngle}
            onCancel={onCancelAngle}
          />
        ) : null}

        {pendingBend ? (
          <PendingValuePanel
            title="Bend uncertainty"
            symbol="Δ ="
            value={pendingBend.deltaDeg}
            min={-179}
            max={179}
            comment={pendingBendComment}
            onValueChange={onPendingBendValueChange}
            onCommentChange={onPendingBendCommentChange}
            onSave={onSaveBend}
            onCancel={onCancelBend}
          />
        ) : null}

        {annotations.length === 0 && !pendingAngle && !pendingBend ? (
          <div className={styles.emptyState}>
            Use the Size, Angle, or Bend tools to add an uncertainty mark.
            Each mark will appear here as a card.
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

            if (annotation.type === "bend") {
              return (
                <BendAnnotationCard
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
