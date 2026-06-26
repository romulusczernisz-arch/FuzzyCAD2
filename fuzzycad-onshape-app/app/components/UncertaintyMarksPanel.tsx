"use client";

import type {
  FuzzyCADUncertaintyDocument,
  SizeUncertaintyAnnotation,
} from "../lib/uncertainty/document";

type UncertaintyMarksPanelProps = {
  document: FuzzyCADUncertaintyDocument;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (annotationId: string | null) => void;
  onEditSizeAnnotation: (annotation: SizeUncertaintyAnnotation) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onCommentChange: (annotationId: string, comment: string) => void;
};

function getAnnotationTitle(annotation: SizeUncertaintyAnnotation) {
  if (annotation.type === "size") {
    return "Size uncertainty";
  }

  return "Uncertainty";
}

export default function UncertaintyMarksPanel({
  document,
  selectedAnnotationId,
  onSelectAnnotation,
  onEditSizeAnnotation,
  onDeleteAnnotation,
  onCommentChange,
}: UncertaintyMarksPanelProps) {
  const annotations = document.annotations;

return (
  <aside
    style={{
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      width: 320,
      zIndex: 18,
      padding: "18px 14px",
      overflowY: "auto",
      borderLeft: "1px solid rgba(148, 163, 184, 0.28)",
      background: "#f8fbff",
      boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.08)",
      fontFamily: "Arial, sans-serif",
      color: "#172033",
      pointerEvents: "none",
    }}
  >
    <div style={{ pointerEvents: "auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 900,
              color: "#1e293b",
            }}
          >
            Uncertainty marks
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 10,
              color: "#64748b",
            }}
          >
            {annotations.length === 0
              ? "No marks yet"
              : `${annotations.length} mark${annotations.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {selectedAnnotationId ? (
          <button
            type="button"
            onClick={() => onSelectAnnotation(null)}
            style={{
              height: 24,
              padding: "0 8px",
              borderRadius: 999,
              border: "1px solid rgba(148, 163, 184, 0.5)",
              background: "rgba(255,255,255,0.72)",
              color: "#475569",
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            Show all
          </button>
        ) : null}
      </div>

      {annotations.length === 0 ? (
        <div
          style={{
            padding: "14px 10px",
            borderRadius: 14,
            border: "1px dashed rgba(148, 163, 184, 0.55)",
            background: "rgba(248, 250, 252, 0.78)",
            color: "#64748b",
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          Use the Size tool to add an uncertainty mark. Each mark will appear
          here as a card.
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 10,
        }}
      >
        {annotations.map((annotation) => {
          const selected = annotation.id === selectedAnnotationId;

          return (
            <article
              key={annotation.id}
              onClick={() => onSelectAnnotation(annotation.id)}
              style={{
                padding: 10,
                borderRadius: 15,
                border: selected
                  ? "1px solid rgba(37, 99, 235, 0.5)"
                  : "1px solid rgba(148, 163, 184, 0.28)",
                background: selected ? "#eef5ff" : "#ffffff",
                boxShadow: selected ? "inset 3px 0 0 #2563eb" : "none",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: selected ? "#1d4ed8" : "#1e293b",
                  }}
                >
                  {getAnnotationTitle(annotation)}
                </div>

                <div
                  style={{
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: selected
                      ? "rgba(37, 99, 235, 0.12)"
                      : "rgba(226, 232, 240, 0.78)",
                    color: selected ? "#1d4ed8" : "#64748b",
                    fontSize: 9,
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  {annotation.target.scope}
                </div>
              </div>

              <textarea
                value={annotation.comment ?? ""}
                placeholder="Add a comment..."
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onChange={(event) => {
                  onCommentChange(annotation.id, event.target.value);
                }}
                style={{
                  width: "100%",
                  minHeight: 58,
                  boxSizing: "border-box",
                  resize: "vertical",
                  padding: "7px 8px",
                  borderRadius: 10,
                  border: "1px solid rgba(148, 163, 184, 0.42)",
                  background: "rgba(255,255,255,0.85)",
                  color: "#334155",
                  fontSize: 11,
                  lineHeight: 1.4,
                  outline: "none",
                  fontFamily: "Arial, sans-serif",
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 6,
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditSizeAnnotation(annotation);
                  }}
                  style={{
                    height: 26,
                    padding: "0 9px",
                    borderRadius: 8,
                    border: "1px solid rgba(43, 108, 255, 0.55)",
                    background: "rgba(43, 108, 255, 0.08)",
                    color: "#1d4ed8",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  Edit
                </button>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteAnnotation(annotation.id);
                  }}
                  style={{
                    height: 26,
                    padding: "0 9px",
                    borderRadius: 8,
                    border: "1px solid rgba(239, 68, 68, 0.55)",
                    background: "rgba(254, 242, 242, 0.85)",
                    color: "#dc2626",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 800,
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
