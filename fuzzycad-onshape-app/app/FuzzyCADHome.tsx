"use client";

import { useSearchParams } from "next/navigation";

export default function FuzzyCADHome() {
  const params = useSearchParams();
  const allParams = Array.from(params.entries());

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>FuzzyCAD Dev</h1>

      <p>
        FuzzyCAD is an Onshape application workspace for exploring
        uncertainty-aware CAD operations between Part Studios and Assemblies.
      </p>

      <h2>Current URL Parameters</h2>

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

      <h2>Development Target</h2>
      <p>
        Next, FuzzyCAD will connect this application tab to Onshape document
        context, OAuth, Assembly relationships, Part Studios, mates, transforms,
        and uncertainty-aware operation metadata.
      </p>
    </main>
  );
}