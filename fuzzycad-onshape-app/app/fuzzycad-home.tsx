"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

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
            onChange={(event) => setSelectedAssemblyId(event.target.value)}
            style={{ padding: 6, minWidth: 260 }}
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