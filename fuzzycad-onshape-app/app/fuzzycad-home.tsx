"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

type ElementsResult = {
  endpoint?: string;
  status?: number;
  ok?: boolean;
  data?: unknown;
  error?: string;
  action?: string;
  details?: unknown;
};

export default function FuzzyCADHome() {
  const params = useSearchParams();
  const allParams = Array.from(params.entries());

  const [elementsResult, setElementsResult] = useState<ElementsResult | null>(
    null
  );

  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");
  const server = params.get("server") || "https://cad.onshape.com";
  const oauthStatus = params.get("oauth");

  async function loadElements() {
    const query = new URLSearchParams({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      server,
    });

    const res = await fetch(`/api/onshape/elements?${query.toString()}`);
    const data = (await res.json()) as ElementsResult;
    setElementsResult(data);
  }

  const connectHref = `/api/oauth/start?documentId=${encodeURIComponent(
    documentId || ""
  )}&workspaceId=${encodeURIComponent(
    workspaceId || ""
  )}&elementId=${encodeURIComponent(
    elementId || ""
  )}&server=${encodeURIComponent(server)}`;

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
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(elementsResult, null, 2)}
        </pre>
      )}
    </main>
  );
}