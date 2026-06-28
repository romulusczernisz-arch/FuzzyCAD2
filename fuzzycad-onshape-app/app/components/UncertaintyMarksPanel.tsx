"use client";

import type {
  FuzzyCADUncertaintyDocument,
  SizeUncertaintyAnnotation,
} from "../lib/uncertainty/document";
import styles from "./UncertaintyMarksPanel.module.css";

type UncertaintyMarksPanelProps = {
  document: FuzzyCADUncertaintyDocument;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (annotationId: string | null) => void;
  onEditSizeAnnotation: (annotation: SizeUncertaintyAnnotation) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onCommentChange: (annotationId: string, comment: string) => void;
  onSaveToOnshape: () => void;
  onLoadFromOnshape: () => void;
};

function getAnnotationTitle(annotation: SizeUncertaintyAnnotation) {
  if (annotation.type === "size") {
    return "Size uncertainty";
  }

  return "Uncertainty";
}

function getMarkCountLabel(count: number) {
  if (count === 0) {
    return "No marks yet";
  }

  return `${count} mark${count === 1 ? "" : "s"}`;
}

export default function UncertaintyMarksPanel({
  document,
  selectedAnnotationId,
  onSelectAnnotation,
  onEditSizeAnnotation,
  onDeleteAnnotation,
  onCommentChange,
  onSaveToOnshape,
  onLoadFromOnshape,
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

          <button
            type="button"
            className={styles.syncButton}
            onClick={onLoadFromOnshape}
          >
            Load from Onshape
          </button>
        </div>

        {annotations.length === 0 ? (
          <div className={styles.emptyState}>
            Use the Size tool to add an uncertainty mark. Each mark will appear
            here as a card.
          </div>
        ) : null}

        <div className={styles.cardList}>
          {annotations.map((annotation) => {
            const selected = annotation.id === selectedAnnotationId;

            return (
              <article
                key={annotation.id}
                className={`${styles.card} ${
                  selected ? styles.cardSelected : ""
                }`}
                onClick={() => onSelectAnnotation(annotation.id)}
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
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onChange={(event) => {
                    onCommentChange(annotation.id, event.target.value);
                  }}
                />

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.editButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditSizeAnnotation(annotation);
                    }}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteAnnotation(annotation.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </aside>
  );
}