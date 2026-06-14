"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  MeshGraphNode,
  PartPlacement,
} from "./components/FuzzyCADGeometryViewer";
import {
  buildPartNodeGraph,
  getLinkedGroup,
  type LogicalOccurrence,
  type LogicalMateEdge,
  type MatchedInstance,
} from "./lib/partGraph";

const FuzzyCADGeometryViewer = dynamic(
  () => import("./components/FuzzyCADGeometryViewer"),
  { ssr: false }
);

type OnshapeElement = {
  id: string;
  name: string;
  type?: string;
  elementType?: string;
  dataType?: string;
};

type ApiResult = {
  endpoint?: string;
  status?: number;
  ok?: boolean;
  data?: unknown;
  graph?: unknown;
  error?: string;
  action?: string;
  details?: unknown;
  counts?: unknown;
  occurrencesPreview?: unknown;
  instancesPreview?: unknown;
  featuresPreview?: unknown;
  manifest?: unknown;
  mode?: string;
  message?: string;
};

type TreeItem = { pathKey: string; name: string };
type TreeGroup = { key: string; name: string; items: TreeItem[] };

function isElementArray(data: unknown): data is OnshapeElement[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "name" in item
    )
  );
}

export default function FuzzyCADHome() {
  const params = useSearchParams();
  const allParams = Array.from(params.entries());

  const [elementsResult, setElementsResult] = useState<ApiResult | null>(null);
  const [assemblyResult, setAssemblyResult] = useState<ApiResult | null>(null);
  const [assemblySummaryResult, setAssemblySummaryResult] =
    useState<ApiResult | null>(null);
  const [relationshipGraphResult, setRelationshipGraphResult] =
    useState<ApiResult | null>(null);

  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string>("");

  const [gltfUrl, setGltfUrl] = useState<string | null>(null);
  const [geometryLoadResult, setGeometryLoadResult] =
    useState<ApiResult | null>(null);
  const [geometryZipManifest, setGeometryZipManifest] =
    useState<ApiResult | null>(null);

  const [meshGraph, setMeshGraph] = useState<MeshGraphNode[]>([]);
  const [selectedMeshNode, setSelectedMeshNode] =
    useState<MeshGraphNode | null>(null);

  const [placements, setPlacements] = useState<PartPlacement[]>([]);
  const [partTree, setPartTree] = useState<TreeGroup[]>([]);
  const [highlightedPathKey, setHighlightedPathKey] = useState<string | null>(
    null
  );

  const [dev, setDev] = useState<boolean>(() => params.get("dev") === "1");
  const [busy, setBusy] = useState(false);

  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");
  const server = params.get("server") || "https://cad.onshape.com";
  const oauthStatus = params.get("oauth");

  const assemblyElements = useMemo(() => {
    const data = elementsResult?.data;
    if (!isElementArray(data)) return [];
    return data.filter((element) => element.elementType === "ASSEMBLY");
  }, [elementsResult]);

  const connectHref = `/api/oauth/start?documentId=${encodeURIComponent(
    documentId || ""
  )}&workspaceId=${encodeURIComponent(
    workspaceId || ""
  )}&elementId=${encodeURIComponent(
    elementId || ""
  )}&server=${encodeURIComponent(server)}`;

  const partGraph = useMemo(() => {
    const g = relationshipGraphResult?.graph as
      | {
          occurrences?: LogicalOccurrence[];
          pathMatches?: {
            occurrencePathKey: string;
            matchedInstance: MatchedInstance;
          }[];
          mateEdges?: LogicalMateEdge[];
        }
      | undefined;

    if (!g?.occurrences || meshGraph.length === 0) return null;

    const pathKeyToInstance = new Map<string, MatchedInstance>(
      (g.pathMatches ?? []).map((m) => [m.occurrencePathKey, m.matchedInstance])
    );

    return buildPartNodeGraph(
      g.occurrences,
      pathKeyToInstance,
      g.mateEdges ?? [],
      meshGraph
    );
  }, [relationshipGraphResult, meshGraph]);

  const linkedGroup = useMemo(() => {
    if (!partGraph || !selectedMeshNode) return null;
    const pathKey = partGraph.byMeshUuid.get(selectedMeshNode.nodeId);
    if (!pathKey) return null;
    return getLinkedGroup(pathKey, partGraph.byPathKey, 1);
  }, [partGraph, selectedMeshNode]);

  // 装配定义 -> placements + 零件树
  useEffect(() => {
    const asm = (
      relationshipGraphResult?.graph as
        | {
            assembly?: {
              documentId?: string;
              workspaceId?: string;
              assemblyElementId?: string;
              server?: string;
            };
          }
        | undefined
    )?.assembly;

    let cancelled = false;

    (async () => {
      if (!asm?.documentId || !asm?.workspaceId || !asm?.assemblyElementId) {
        if (!cancelled) {
          setPlacements([]);
          setPartTree([]);
        }
        return;
      }

      const base = new URLSearchParams({
        documentId: asm.documentId,
        workspaceId: asm.workspaceId,
        assemblyElementId: asm.assemblyElementId,
        server: asm.server || "https://cad.onshape.com",
      });

      try {
        const res = await fetch("/api/onshape/assembly?" + base.toString());
        const json = await res.json();
        const def = json?.data ?? json;
        const root = def?.rootAssembly ?? def;
        const occurrences = Array.isArray(root?.occurrences)
          ? root.occurrences
          : [];
        const subs = Array.isArray(def?.subAssemblies) ? def.subAssemblies : [];

        const nameById = new Map<string, string>();
        const add = (arr: unknown) => {
          if (!Array.isArray(arr)) return;
          for (const inst of arr) {
            const i = inst as { id?: unknown; name?: unknown };
            if (typeof i?.id === "string") {
              nameById.set(i.id, typeof i.name === "string" ? i.name : i.id);
            }
          }
        };
        add(root?.instances);
        for (const s of subs) add((s as { instances?: unknown })?.instances);

        const next: PartPlacement[] = [];
        const groupsMap = new Map<string, TreeGroup>();

        for (const o of occurrences) {
          const occ = o as { transform?: unknown; path?: unknown };
          if (!Array.isArray(occ.path) || occ.path.length === 0) continue;
          const path = occ.path as string[];
          const pathKey = path.join("/");
          const leafId = path[path.length - 1];
          const leafName = nameById.get(leafId) ?? leafId;

          const nested = path.length > 1;
          const subKey = nested ? path[0] : "__root__";
          const subName = nested
            ? nameById.get(path[0]) ?? path[0]
            : "(顶层零件)";
          let grp = groupsMap.get(subKey);
          if (!grp) {
            grp = { key: subKey, name: subName, items: [] };
            groupsMap.set(subKey, grp);
          }
          grp.items.push({ pathKey, name: leafName });

          if (Array.isArray(occ.transform) && occ.transform.length === 16) {
            next.push({
              pathKey,
              partName: nameById.get(leafId) ?? null,
              transform: occ.transform as number[],
            });
          }
        }

        if (!cancelled) {
          setPlacements(next);
          setPartTree(Array.from(groupsMap.values()));
        }
      } catch {
        if (!cancelled) {
          setPlacements([]);
          setPartTree([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relationshipGraphResult]);

  // 打开就自动拉 elements（没连接会返回空，下面提示连接）
  useEffect(() => {
    if (documentId && workspaceId) loadElements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, workspaceId]);

  function resetGeometryState() {
    setMeshGraph([]);
    setSelectedMeshNode(null);
    setHighlightedPathKey(null);
    setGeometryLoadResult(null);
    if (gltfUrl) {
      URL.revokeObjectURL(gltfUrl);
      setGltfUrl(null);
    }
  }

  async function loadAssemblyGeometry() {
    resetGeometryState();
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });

    const res = await fetch(`/api/onshape/assembly-gltf?${query.toString()}`);
    const contentType = res.headers.get("content-type") || "";

    if (
      res.ok &&
      (contentType.includes("model/gltf-binary") ||
        contentType.includes("model/gltf+json"))
    ) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setGltfUrl(url);
      setGeometryLoadResult({
        status: res.status,
        ok: true,
        data: {
          contentType,
          size: blob.size,
          zipMode: res.headers.get("x-fuzzycad-zip-mode"),
          extractedFile: res.headers.get("x-fuzzycad-extracted-file"),
          gltfCandidates: res.headers.get("x-fuzzycad-gltf-candidates"),
          translationId: res.headers.get("x-fuzzycad-translation-id"),
          externalDataId: res.headers.get("x-fuzzycad-external-data-id"),
        },
      });
      return;
    }

    const data = (await res.json()) as ApiResult;
    setGeometryLoadResult(data);
  }

  async function inspectAssemblyGeometryZip() {
    setGeometryZipManifest(null);
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
      debugZip: "1",
    });
    const res = await fetch(`/api/onshape/assembly-gltf?${query.toString()}`);
    const data = (await res.json()) as ApiResult;
    setGeometryZipManifest(data);
  }

  async function loadElements() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      server,
    });
    const res = await fetch(`/api/onshape/elements?${query.toString()}`);
    const data = (await res.json()) as ApiResult;
    setElementsResult(data);

    if (data.ok && isElementArray(data.data)) {
      const firstAssembly = data.data.find(
        (element) => element.elementType === "ASSEMBLY"
      );
      if (firstAssembly) setSelectedAssemblyId(firstAssembly.id);
    }
  }

  async function loadAssemblyDefinition() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });
    const res = await fetch(`/api/onshape/assembly?${query.toString()}`);
    setAssemblyResult((await res.json()) as ApiResult);
  }

  async function loadAssemblySummary() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });
    const res = await fetch(`/api/fuzzycad/assembly-summary?${query.toString()}`);
    setAssemblySummaryResult((await res.json()) as ApiResult);
  }

  async function buildRelationshipGraph() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });
    const res = await fetch(
      `/api/fuzzycad/relationship-graph?${query.toString()}`
    );
    setRelationshipGraphResult((await res.json()) as ApiResult);
  }

  // 主操作：一键 建图 + 加载几何
  async function loadSelectedAssembly() {
    if (!selectedAssemblyId) return;
    setBusy(true);
    try {
      await Promise.all([buildRelationshipGraph(), loadAssemblyGeometry()]);
    } finally {
      setBusy(false);
    }
  }

  const connected =
    oauthStatus === "connected" || assemblyElements.length > 0;

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* 左侧栏 */}
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          height: "100%",
          boxSizing: "border-box",
          borderRight: "1px solid #e3e3e3",
          background: "#fafafa",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 700 }}>FuzzyCAD</div>

        {!connected && (
          
            href={connectHref}
            style={{
              display: "block",
              textAlign: "center",
              padding: "8px 12px",
              border: "1px solid #999",
              borderRadius: 6,
              textDecoration: "none",
              color: "#000",
              background: "#fff",
            }}
          >
            连接 Onshape
          </a>
        )}

        {assemblyElements.length > 0 ? (
          <>
            <label style={{ fontSize: 12, color: "#666" }}>装配</label>
            <select
              value={selectedAssemblyId}
              onChange={(e) => {
                setSelectedAssemblyId(e.target.value);
                resetGeometryState();
                setGeometryZipManifest(null);
              }}
              style={{ padding: 6, width: "100%" }}
            >
              {assemblyElements.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <button
              onClick={loadSelectedAssembly}
              disabled={!selectedAssemblyId || busy}
              style={{
                padding: "9px 12px",
                border: "1px solid #2b6cff",
                borderRadius: 6,
                cursor: selectedAssemblyId && !busy ? "pointer" : "not-allowed",
                background: selectedAssemblyId && !busy ? "#2b6cff" : "#bcd0ff",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              {busy ? "加载中…" : "加载装配"}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 13, color: "#888" }}>
            {connected ? "没找到装配。" : "请先连接 Onshape。"}
          </p>
        )}

        {/* 零件树 */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            marginTop: 4,
            borderTop: "1px solid #e3e3e3",
            paddingTop: 8,
            fontSize: 13,
          }}
        >
          {partTree.length === 0 ? (
            <p style={{ color: "#aaa", margin: 0 }}>加载后这里显示零件。</p>
          ) : (
            partTree.map((grp) => (
              <details key={grp.key} open>
                <summary
                  style={{ cursor: "pointer", fontWeight: 600, margin: "6px 0" }}
                >
                  {grp.name} ({grp.items.length})
                </summary>
                {grp.items.map((it) => (
                  <div
                    key={it.pathKey}
                    onClick={() =>
                      setHighlightedPathKey(
                        highlightedPathKey === it.pathKey ? null : it.pathKey
                      )
                    }
                    style={{
                      cursor: "pointer",
                      padding: "3px 8px",
                      marginLeft: 8,
                      borderRadius: 4,
                      background:
                        highlightedPathKey === it.pathKey
                          ? "#2b6cff"
                          : "transparent",
                      color: highlightedPathKey === it.pathKey ? "#fff" : "#222",
                    }}
                  >
                    {it.name}
                  </div>
                ))}
              </details>
            ))
          )}
        </div>

        <button
          onClick={() => setDev((v) => !v)}
          style={{
            padding: "6px 10px",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
            fontSize: 12,
            color: "#666",
          }}
        >
          {dev ? "隐藏调试面板" : "调试面板"}
        </button>
      </aside>

      {/* 右侧 3D 充满 */}
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <FuzzyCADGeometryViewer
          gltfUrl={gltfUrl}
          placements={placements}
          highlightedPathKey={highlightedPathKey}
          onMeshGraph={setMeshGraph}
          onSelectedNode={setSelectedMeshNode}
        />
      </div>

      {/* 调试覆盖层：原来那一整套都搬这里 */}
      {dev && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.98)",
            overflow: "auto",
            padding: 24,
            zIndex: 10,
          }}
        >
          <button
            onClick={() => setDev(false)}
            style={{
              float: "right",
              padding: "6px 12px",
              border: "1px solid #999",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            关闭
          </button>

          <h1>FuzzyCAD Dev</h1>

          <h2>Current Onshape Context</h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[
                ["documentId", documentId],
                ["workspaceId", workspaceId],
                ["elementId", elementId],
                ["server", server],
              ].map(([k, v]) => (
                <tr key={k as string}>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>{k}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Actions</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            
              href={connectHref}
              style={{
                padding: "8px 12px",
                border: "1px solid #999",
                borderRadius: 4,
                textDecoration: "none",
                color: "black",
                background: "#f5f5f5",
              }}
            >
              Connect Onshape
            </a>
            <button onClick={loadElements}>Load Document Elements</button>
            <button onClick={loadAssemblyDefinition} disabled={!selectedAssemblyId}>
              Load Raw Assembly Definition
            </button>
            <button onClick={loadAssemblySummary} disabled={!selectedAssemblyId}>
              Load Assembly Summary
            </button>
            <button onClick={buildRelationshipGraph} disabled={!selectedAssemblyId}>
              Build Relationship Graph
            </button>
            <button onClick={loadAssemblyGeometry} disabled={!selectedAssemblyId}>
              Load Assembly Geometry
            </button>
            <button onClick={inspectAssemblyGeometryZip} disabled={!selectedAssemblyId}>
              Inspect Geometry ZIP
            </button>
          </div>

          {partGraph && (
            <p style={{ marginTop: 16 }}>
              Matched parts:{" "}
              <strong>
                {partGraph.residualStats.matched}/{partGraph.residualStats.total}
              </strong>{" "}
              · mean residual:{" "}
              <strong>{partGraph.residualStats.mean.toFixed(5)}</strong> · scale:{" "}
              <strong>{partGraph.scale}</strong>
              {selectedMeshNode && (
                <>
                  {" "}
                  · clicked:{" "}
                  <strong>
                    {partGraph.byMeshUuid.get(selectedMeshNode.nodeId) ??
                      "(no match)"}
                  </strong>
                  {linkedGroup ? <> · linked: {linkedGroup.length}</> : null}
                </>
              )}
            </p>
          )}

          {meshGraph.length > 0 && (
            <p>
              Total objects: <strong>{meshGraph.length}</strong>; Mesh:{" "}
              <strong>{meshGraph.filter((n) => n.isMesh).length}</strong>
            </p>
          )}

          {[
            ["Relationship Graph", relationshipGraphResult],
            ["Assembly Summary", assemblySummaryResult],
            ["Raw Assembly", assemblyResult],
            ["Elements", elementsResult],
            ["Geometry Load", geometryLoadResult],
            ["Geometry ZIP", geometryZipManifest],
          ].map(([title, val]) =>
            val ? (
              <details key={title as string} style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  {title as string}
                </summary>
                <pre
                  style={{
                    padding: 12,
                    background: "#f5f5f5",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    maxHeight: 360,
                  }}
                >
                  {JSON.stringify(val, null, 2)}
                </pre>
              </details>
            ) : null
          )}

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              All URL Parameters
            </summary>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {allParams.map(([key, value]) => (
                  <tr key={key}>
                    <td style={{ border: "1px solid #ccc", padding: 8 }}>{key}</td>
                    <td style={{ border: "1px solid #ccc", padding: 8 }}>
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </main>
  );
}