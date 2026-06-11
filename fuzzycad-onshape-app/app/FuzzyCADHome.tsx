"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function FuzzyCADHome() {
  const params = useSearchParams();
  const allParams = Array.from(params.entries());

  const [elementsResult, setElementsResult] = useState<any>(null);

  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const server = params.get("server") || "https://cad.onshape.com";

  async function loadElements() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      server,
    });

    const res = await fetch(`/api/onshape/elements?${query.toString()}`);
    const data = await res.json();
    setElementsResult(data);
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
            <td style={{ border: "1px solid #ccc", padding: 8 }}>{documentId}</td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>workspaceId</td>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>{workspaceId}</td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>server</td>
            <td style={{ border: "1px solid #ccc", padding: 8 }}>{server}</td>
          </tr>
        </tbody>
      </table>

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
                <td style={{ border: "1px solid #ccc", padding: 8 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Document Elements Probe</h2>

      <button
        onClick={loadElements}
        style={{
          padding: "8px 12px",
          border: "1px solid #999",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        Load Document Elements
      </button>

      {elementsResult && (
        <pre
          style={{
            marginTop: 16,
            padding: 16,
            background: "#f5f5f5",
            overflow: "auto",
          }}
        >
          {JSON.stringify(elementsResult, null, 2)}
        </pre>
      )}
    </main>
  );
}