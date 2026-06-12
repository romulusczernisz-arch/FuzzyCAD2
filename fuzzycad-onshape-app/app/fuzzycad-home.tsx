"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { MeshGraphNode } from "./components/FuzzyCADGeometryViewer";

const FuzzyCADGeometryViewer = dynamic(
  () => import("./components/FuzzyCADGeometryViewer"),
  {
    ssr: false,
  }
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

  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");
  const server = params.get("server") || "https://cad.onshape.com";
  const oauthStatus = params.get("oauth");

  const assemblyElements = useMemo(() => {
    const data = elementsResult?.data;

    if (!isElementArray(data)) {
      return [];
    }

    return data.filter((element) => element.elementType === "ASSEMBLY");
  }, [elementsResult]);

  const connectHref = `/api/oauth/start?documentId=${encodeURIComponent(
    documentId || ""
  )}&workspaceId=${encodeURIComponent(
    workspaceId || ""
  )}&elementId=${encodeURIComponent(elementId || "")}&server=${encodeURIComponent(
    server
  )}`;

  function resetGeometryState() {
    setMeshGraph([]);
    setSelectedMeshNode(null);
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
          selectedNodes: res.headers.get("x-fuzzycad-selected-nodes"),
          selectedMeshes: res.headers.get("x-fuzzycad-selected-meshes"),
          selectedScenes: res.headers.get("x-fuzzycad-selected-scenes"),
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

      if (firstAssembly) {
        setSelectedAssemblyId(firstAssembly.id);
      }
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
    const data = (await res.json()) as ApiResult;

    setAssemblyResult(data);
  }

  async function loadAssemblySummary() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedAssemblyId,
      server,
    });

    const res = await fetch(`/api/fuzzycad/assembly-summary?${query.toString()}`);
    const data = (await res.json()) as ApiResult;

    setAssemblySummaryResult(data);
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
    const data = (await res.json()) as ApiResult;

    setRelationshipGraphResult(data);
  }

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>FuzzyCAD Dev</h1>

      <p>
        FuzzyCAD is an Onshape application workspace for exploring
        uncertainty-aware CAD operations between Part Studios and Assemblies.
      </p>

      <h2>Current Onshape Context</h2>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>documentId</td>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>
              {documentId}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>workspaceId</td>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>
              {workspaceId}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>elementId</td>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>
              {elementId}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>server</td>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>{server}</td>
          </tr>
        </tbody>
      </table>

      <h2>Onshape Connection</h2>

      <p>
        Status:{" "}
        <strong>
          {oauthStatus === "connected" ? "Connected" : "Not connected"}
        </strong>
      </p>

      <a
        href={connectHref}
        style={{
          display: "inline-block",
          padding: "8px 12px",
          border: "1px solid #999",
          borderRadius: 4,
          textDecoration: "none",
          color: "black",
          background: "#f5f5f5",
          marginBottom: 16,
        }}
      >
        Connect Onshape
      </a>

      <h2>Document Elements</h2>

      <button
        onClick={loadElements}
        style={{
          padding: "8px 12px",
          border: "1px solid #999",
          borderRadius: 4,
          cursor: "pointer",
          marginRight: 8,
        }}
      >
        Load Document Elements
      </button>

      {assemblyElements.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label htmlFor="assembly-select">
            <strong>Select Assembly: </strong>
          </label>

          <select
            id="assembly-select"
            value={selectedAssemblyId}
            onChange={(event) => {
              setSelectedAssemblyId(event.target.value);
              resetGeometryState();
              setGeometryZipManifest(null);
            }}
            style={{ padding: 6, minWidth: 360 }}
          >
            {assemblyElements.map((assembly) => (
              <option key={assembly.id} value={assembly.id}>
                {assembly.name} — {assembly.id}
              </option>
            ))}
          </select>
        </div>
      )}

      {elementsResult && (
        <pre
          style={{
            marginTop: 16,
            padding: 16,
            background: "#f5f5f5",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            maxHeight: 280,
          }}
        >
          {JSON.stringify(elementsResult, null, 2)}
        </pre>
      )}

      <h2>Assembly Data</h2>

      <button
        onClick={loadAssemblyDefinition}
        disabled={!selectedAssemblyId}
        style={{
          padding: "8px 12px",
          border: "1px solid #999",
          borderRadius: 4,
          cursor: selectedAssemblyId ? "pointer" : "not-allowed",
          background: selectedAssemblyId ? "#f5f5f5" : "#ddd",
          marginRight: 8,
        }}
      >
        Load Raw Assembly Definition
      </button>

      <button
        onClick={loadAssemblySummary}
        disabled={!selectedAssemblyId}
        style={{
          padding: "8px 12px",
          border: "1px solid #999",
          borderRadius: 4,
          cursor: selectedAssemblyId ? "pointer" : "not-allowed",
          background: selectedAssemblyId ? "#f5f5f5" : "#ddd",
          marginRight: 8,
        }}
      >
        Load Assembly Summary
      </button>

      <button
        onClick={buildRelationshipGraph}
        disabled={!selectedAssemblyId}
        style={{
          padding: "8px 12px",
          border: "1px solid #333",
          borderRadius: 4,
          cursor: selectedAssemblyId ? "pointer" : "not-allowed",
          background: selectedAssemblyId ? "#eaf2ff" : "#ddd",
        }}
      >
        Build FuzzyCAD Relationship Graph
      </button>

      {relationshipGraphResult && (
        <>
          <h3>FuzzyCAD Relationship Graph</h3>
          <pre
            style={{
              marginTop: 16,
              padding: 16,
              background: "#eaf2ff",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              maxHeight: 520,
            }}
          >
            {JSON.stringify(relationshipGraphResult, null, 2)}
          </pre>
        </>
      )}

      {assemblySummaryResult && (
        <>
          <h3>Assembly Summary</h3>
          <pre
            style={{
              marginTop: 16,
              padding: 16,
              background: "#eef7ff",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              maxHeight: 360,
            }}
          >
            {JSON.stringify(assemblySummaryResult, null, 2)}
          </pre>
        </>
      )}

      {assemblyResult && (
        <>
          <h3>Raw Assembly Definition</h3>
          <pre
            style={{
              marginTop: 16,
              padding: 16,
              background: "#f5f5f5",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              maxHeight: 360,
            }}
          >
            {JSON.stringify(assemblyResult, null, 2)}
          </pre>
        </>
      )}

      <h2>Geometry Viewer</h2>

      <button
        onClick={loadAssemblyGeometry}
        disabled={!selectedAssemblyId}
        style={{
          padding: "8px 12px",
          border: "1px solid #333",
          borderRadius: 4,
          cursor: selectedAssemblyId ? "pointer" : "not-allowed",
          background: selectedAssemblyId ? "#e8ffe8" : "#ddd",
          marginBottom: 12,
        }}
      >
        Load Assembly Geometry
      </button>

      <button
        onClick={inspectAssemblyGeometryZip}
        disabled={!selectedAssemblyId}
        style={{
          padding: "8px 12px",
          border: "1px solid #333",
          borderRadius: 4,
          cursor: selectedAssemblyId ? "pointer" : "not-allowed",
          background: selectedAssemblyId ? "#fff7e6" : "#ddd",
          marginLeft: 8,
          marginBottom: 12,
        }}
      >
        Inspect Geometry ZIP
      </button>

      <FuzzyCADGeometryViewer
        gltfUrl={gltfUrl}
        onMeshGraph={setMeshGraph}
        onSelectedNode={setSelectedMeshNode}
      />

      {meshGraph.length > 0 && (
        <>
          <h3>Mesh Graph Inspector</h3>

          <p>
            Total objects: <strong>{meshGraph.length}</strong>; Mesh objects:{" "}
            <strong>{meshGraph.filter((node) => node.isMesh).length}</strong>
          </p>

          {selectedMeshNode && (
            <div
              style={{
                padding: 12,
                marginBottom: 12,
                background: "#fff7e6",
                border: "1px solid #e0c27a",
                borderRadius: 6,
              }}
            >
              <strong>Selected Mesh/Object</strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  overflow: "auto",
                  maxHeight: 240,
                }}
              >
                {JSON.stringify(selectedMeshNode, null, 2)}
              </pre>
            </div>
          )}

          <div
            style={{
              overflow: "auto",
              maxHeight: 420,
              border: "1px solid #ccc",
            }}
          >
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                fontSize: 12,
              }}
            >
              <thead>
                <tr>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>#</th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>Name</th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>Type</th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>
                    Parent
                  </th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>Mesh</th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>
                    Material
                  </th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>
                    Vertices
                  </th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>
                    Triangles
                  </th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>
                    World Pos
                  </th>
                  <th style={{ border: "1px solid #ccc", padding: 6 }}>Path</th>
                </tr>
              </thead>

              <tbody>
                {meshGraph.slice(0, 300).map((node, index) => (
                  <tr
                    key={node.nodeId}
                    style={{
                      background:
                        selectedMeshNode?.nodeId === node.nodeId
                          ? "#fff7e6"
                          : node.isMesh
                            ? "#ffffff"
                            : "#f7f7f7",
                    }}
                  >
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {index}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.name || "(unnamed)"}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.type}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.parentName || "—"}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.isMesh ? "yes" : "no"}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.materialName || "—"}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.vertexCount ?? "—"}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.triangleCount ?? "—"}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.worldPosition.x.toFixed(3)},{" "}
                      {node.worldPosition.y.toFixed(3)},{" "}
                      {node.worldPosition.z.toFixed(3)}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: 6 }}>
                      {node.path}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meshGraph.length > 300 && (
            <p style={{ fontSize: 12 }}>
              Showing first 300 objects only. Full count: {meshGraph.length}.
            </p>
          )}
        </>
      )}

      {geometryLoadResult && (
        <>
          <h3>Geometry Load Result</h3>
          <pre
            style={{
              marginTop: 16,
              padding: 16,
              background: "#f2fff2",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              maxHeight: 280,
            }}
          >
            {JSON.stringify(geometryLoadResult, null, 2)}
          </pre>
        </>
      )}

      {geometryZipManifest && (
        <>
          <h3>Geometry ZIP Manifest</h3>
          <pre
            style={{
              marginTop: 16,
              padding: 16,
              background: "#fff7e6",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              maxHeight: 520,
            }}
          >
            {JSON.stringify(geometryZipManifest, null, 2)}
          </pre>
        </>
      )}

      <h2>All URL Parameters</h2>

      {allParams.length === 0 ? (
        <p>No query parameters received yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Key</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Value</th>
            </tr>
          </thead>

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
      )}
    </main>
  );
}