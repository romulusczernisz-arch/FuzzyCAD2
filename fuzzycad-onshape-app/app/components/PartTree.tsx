"use client";

import styles from "../fuzzycad-home.module.css";

export type TreeItem = {
  pathKey: string;
  name: string;
};

export type TreeGroup = {
  key: string;
  name: string;
  items: TreeItem[];
};

type PartTreeProps = {
  groups: TreeGroup[];
  selectedPathKey: string | null;
  onSelectPathKey: (pathKey: string | null) => void;
  emptyText?: string;
};

export default function PartTree({
  groups,
  selectedPathKey,
  onSelectPathKey,
  emptyText = "Loaded parts will appear here.",
}: PartTreeProps) {
  return (
    <div className={styles.partTree}>
      {groups.length === 0 ? (
        <p className={styles.partTreeEmpty}>{emptyText}</p>
      ) : (
        groups.map((group) => (
          <details key={group.key} open>
            <summary className={styles.partGroupSummary}>
              {group.name} ({group.items.length})
            </summary>

            {group.items.map((item) => {
              const selected = selectedPathKey === item.pathKey;

              return (
                <div
                  key={item.pathKey}
                  onClick={() => {
                    onSelectPathKey(selected ? null : item.pathKey);
                  }}
                  className={`${styles.partItem} ${
                    selected ? styles.partItemSelected : ""
                  }`}
                >
                  {item.name}
                </div>
              );
            })}
          </details>
        ))
      )}
    </div>
  );
}