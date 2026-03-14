import { useState } from "react";
import { Link } from "react-router-dom";
import { useCallSocket } from "@/hooks/useCallSocket";

export function CallerView() {
  const [callerId, setCallerId] = useState("");
  const [location, setLocation] = useState("");

  const {
    status,
    incidentId,
    transcript,
    classification,
    errorMessage,
    startCall,
    endCall,
  } = useCallSocket();

  const canStart = status === "idle" || status === "ended" || status === "error";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0c10",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 16px",
      }}
    >
      {/* Header */}
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 32,
        }}
      >
        <span
          style={{ fontWeight: 800, fontSize: 20, color: "#f8fafc" }}
        >
          RapidResponse.ai
        </span>
        <Link
          to="/dashboard"
          style={{
            color: "#64748b",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ← Dispatcher Dashboard
        </Link>
      </div>

      {/* Call card */}
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          background: "#0d1117",
          borderRadius: 16,
          border: "1px solid #1e2433",
          padding: 32,
        }}
      >
        <h1
          style={{
            margin: "0 0 24px",
            fontSize: 22,
            fontWeight: 700,
            color: "#f1f5f9",
            textAlign: "center",
          }}
        >
          Emergency Call Simulator
        </h1>

        {/* Setup form */}
        {canStart && (
          <div style={{ marginBottom: 24 }}>
            <label
              style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}
            >
              CALLER ID
            </label>
            <input
              value={callerId}
              onChange={(e) => setCallerId(e.target.value)}
              placeholder="e.g. CALLER-001"
              style={{
                width: "100%",
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#e2e8f0",
                fontSize: 14,
                marginBottom: 12,
                boxSizing: "border-box",
              }}
            />
            <label
              style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}
            >
              LOCATION
            </label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. 123 Main St, Springfield"
              style={{
                width: "100%",
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#e2e8f0",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Error */}
        {errorMessage && (
          <div
            style={{
              background: "#2d0f0f",
              border: "1px solid #7f1d1d",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#fca5a5",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Status indicator */}
        {status === "active" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
              fontSize: 13,
              color: "#22c55e",
              fontWeight: 600,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#22c55e",
                animation: "pulse 1.5s infinite",
              }}
            />
            CALL IN PROGRESS
            {incidentId && (
              <span style={{ color: "#64748b", fontWeight: 400 }}>
                — Incident #{incidentId.slice(0, 8)}
              </span>
            )}
          </div>
        )}

        {status === "connecting" && (
          <div
            style={{
              fontSize: 13,
              color: "#f97316",
              marginBottom: 16,
              fontWeight: 600,
            }}
          >
            Connecting...
          </div>
        )}

        {status === "ended" && (
          <div
            style={{
              fontSize: 13,
              color: "#64748b",
              marginBottom: 16,
              fontWeight: 600,
            }}
          >
            Call ended.
          </div>
        )}

        {/* Classification banner */}
        {classification && (
          <div
            style={{
              background: "#0f2940",
              border: "1px solid #1d4ed8",
              borderRadius: 8,
              padding: "10px 16px",
              marginBottom: 16,
              fontSize: 13,
              color: "#bfdbfe",
            }}
          >
            <strong>Incident classified:</strong>{" "}
            {classification.incident_type.replace("_", " ")} —{" "}
            <strong style={{ color: "#f97316" }}>
              {classification.priority}
            </strong>
          </div>
        )}

        {/* CTA buttons */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          {canStart && (
            <button
              onClick={() =>
                void startCall(
                  callerId || "CALLER-ANON",
                  location || "Unknown location"
                )
              }
              style={{
                background: "#ef4444",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 32px",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Call 911
            </button>
          )}
          {status === "active" && (
            <button
              onClick={endCall}
              style={{
                background: "#1e2433",
                color: "#94a3b8",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "12px 32px",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Hang Up
            </button>
          )}
        </div>

        {/* Transcript */}
        {transcript.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div
              style={{
                fontSize: 12,
                color: "#475569",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 12,
              }}
            >
              Transcript
            </div>
            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {transcript.map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection:
                      line.role === "agent" ? "row-reverse" : "row",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: line.role === "agent" ? "#3b82f6" : "#22c55e",
                      minWidth: 40,
                      textAlign: "center",
                      paddingTop: 4,
                    }}
                  >
                    {line.role === "agent" ? "AI" : "You"}
                  </span>
                  <div
                    style={{
                      background:
                        line.role === "agent" ? "#1e3a5f" : "#14291e",
                      borderRadius: 8,
                      padding: "8px 14px",
                      fontSize: 13,
                      color: "#e2e8f0",
                      maxWidth: "80%",
                      lineHeight: 1.6,
                    }}
                  >
                    {line.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
