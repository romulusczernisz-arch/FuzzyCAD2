"use client";

import { useSearchParams } from "next/navigation";

export default function Home() {
  const params = useSearchParams();

  const allParams = Array.from(params.entries());

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>FuzzyCAD Dev</h1>

      <p>
        This is the FuzzyCAD application tab for exploring uncertainty-aware CAD
        operations between Onshape Part Studios and Assemblies.
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

      <h2>Next Target</h2>
      <p>
        Once we can read the current Onshape document context, FuzzyCAD will use
        the Onshape API to inspect assemblies, Part Studios, mates, transforms,
        and source-part relationships.
      </p>
    </main>
  );
}