"use client";

import { useCallback, useEffect, useState } from "react";

type ApiCallRecord = {
  timestamp: string;
  route: string;
  operation: string;
  status: number;
  ok: boolean;
  endpoint: string;
  durationMs: number;
  rateRemaining: string | null;
  retryAfter: string | null;
};

type ApiUsage = {
  totalCalls: number;
  byRoute: Record<string, number>;
  byOperation: Record<string, number>;
  recentCalls: ApiCallRecord[];
};

type ApiUsageResponse = {
  ok: boolean;
  reset: boolean;
  usage: ApiUsage;
};

function sortedEntries(record: Record<string, number>) {
  return Object.entries(record).sort((a, b) => b[1] - a[1]);
}

function formatTime(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleTimeString();
}

export default function ApiUsagePanel() {
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const [loading, setLoading] = useState(false);

  const loadUsage = useCallback(async (reset = false, showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const res = await fetch(
        `/api/fuzzycad/api-usage${reset ? "?reset=1" : ""}`,
        {
          cache: "no-store",
        },
      );

      const data = (await res.json()) as ApiUsageResponse;
      setUsage(data.usage);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const loadWithoutSpinner = () => {
      void loadUsage(false, false);
    };

    const timeoutId = window.setTimeout(loadWithoutSpinner, 0);
    const intervalId = window.setInterval(loadWithoutSpinner, 2000);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [loadUsage]);

  const operationEntries = sortedEntries(usage?.byOperation ?? {});
  const routeEntries = sortedEntries(usage?.byRoute ?? {});

  return (
    <section
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        background: "#fafafa",
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Onshape API Usage</h2>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 12 }}>
            Counts only real Onshape calls made through FuzzyCAD server routes.
            Cache hits should not increase this number.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              void loadUsage();
            }}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          <button
            onClick={() => {
              void loadUsage(true);
            }}
            disabled={loading}
          >
            Reset
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: 6,
            padding: 10,
            background: "white",
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>Total calls</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {usage?.totalCalls ?? 0}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: 6,
            padding: 10,
            background: "white",
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>Operations</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {usage ? Object.keys(usage.byOperation).length : 0}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: 6,
            padding: 10,
            background: "white",
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>Routes</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {usage ? Object.keys(usage.byRoute).length : 0}
          </div>
        </div>
      </div>

      <details open>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          By operation
        </summary>

        <table style={{ width: "100%", marginTop: 8, fontSize: 12 }}>
          <tbody>
            {operationEntries.map(([operation, count]) => (
              <tr key={operation}>
                <td style={{ padding: "4px 0" }}>{operation}</td>
                <td style={{ padding: "4px 0", textAlign: "right" }}>
                  {count}
                </td>
              </tr>
            ))}

            {operationEntries.length === 0 ? (
              <tr>
                <td style={{ color: "#777" }}>No Onshape API calls recorded.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </details>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          By route
        </summary>

        <table style={{ width: "100%", marginTop: 8, fontSize: 12 }}>
          <tbody>
            {routeEntries.map(([route, count]) => (
              <tr key={route}>
                <td
                  style={{
                    padding: "4px 0",
                    wordBreak: "break-word",
                  }}
                >
                  {route}
                </td>
                <td style={{ padding: "4px 0", textAlign: "right" }}>
                  {count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          Recent calls
        </summary>

        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <table
            style={{
              width: "100%",
              minWidth: 620,
              marginTop: 8,
              fontSize: 11,
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Time</th>
                <th style={{ textAlign: "left" }}>Operation</th>
                <th style={{ textAlign: "right" }}>Status</th>
                <th style={{ textAlign: "right" }}>ms</th>
                <th style={{ textAlign: "right" }}>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.recentCalls ?? []).slice(0, 20).map((call, index) => (
                <tr key={`${call.timestamp}-${call.operation}-${index}`}>
                  <td style={{ padding: "4px 0" }}>
                    {formatTime(call.timestamp)}
                  </td>
                  <td style={{ padding: "4px 0" }}>{call.operation}</td>
                  <td style={{ padding: "4px 0", textAlign: "right" }}>
                    {call.status}
                  </td>
                  <td style={{ padding: "4px 0", textAlign: "right" }}>
                    {call.durationMs}
                  </td>
                  <td style={{ padding: "4px 0", textAlign: "right" }}>
                    {call.rateRemaining ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}