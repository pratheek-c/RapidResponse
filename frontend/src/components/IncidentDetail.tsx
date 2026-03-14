import { useState, useEffect } from "react";
import type {
  Incident,
  TranscriptionTurn,
  Unit,
  Dispatch,
  IncidentReport,
} from "@/types";
import { PriorityBadge, StatusBadge, TypeChip } from "./Badges";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.5,
        color: "#888",
        textTransform: "uppercase",
        marginBottom: 8,
        paddingBottom: 4,
        borderBottom: "1px solid #e5e5e5",
      }}
    >
      {title}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  incident: Incident;
  units: Unit[];
  onDispatch: (incidentId: string, unitType: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IncidentDetail({ incident, units, onDispatch }: Props) {
  const [turns, setTurns] = useState<TranscriptionTurn[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [report, setReport] = useState<IncidentReport | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [dispatching, setDispatching] = useState(false);
  const [activeTab, setActiveTab] = useState<"report" | "transcript">("report");

  useEffect(() => {
    setTurns([]);
    setDispatches([]);
    setReport(null);
    setSelectedUnit("");

    // fetch transcript turns
    fetch(`${API_BASE}/incidents/${incident.id}/transcript`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: TranscriptionTurn[] }) => {
        if (j.ok) setTurns(j.data);
      })
      .catch(() => undefined);

    // fetch dispatches for this incident
    fetch(`${API_BASE}/dispatch/${incident.id}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: Dispatch[] }) => {
        if (j.ok) setDispatches(j.data);
      })
      .catch(() => undefined);

    // fetch AI-generated report
    fetch(`${API_BASE}/report/${incident.id}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: IncidentReport }) => {
        if (j.ok) setReport(j.data);
      })
      .catch(() => undefined);
  }, [incident.id]);

  const availableUnits = units.filter((u) => u.status === "available");

  const handleDispatch = async () => {
    if (!selectedUnit) return;
    setDispatching(true);
    await onDispatch(incident.id, selectedUnit);
    setDispatching(false);
    setSelectedUnit("");
  };

  return (
    <div style={{ padding: "20px 24px", background: "#fff", minHeight: "100%" }}>
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 18,
          flexWrap: "wrap",
          borderBottom: "2px solid #000",
          paddingBottom: 14,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 800,
            color: "#000",
            letterSpacing: -0.3,
            fontFamily: "monospace",
          }}
        >
          INC-{incident.id.slice(0, 8).toUpperCase()}
        </h2>
        <StatusBadge status={incident.status} />
        {incident.priority && <PriorityBadge priority={incident.priority} />}
        {incident.type && <TypeChip type={incident.type} />}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#999",
            fontFamily: "monospace",
          }}
        >
          {new Date(incident.created_at).toLocaleString()}
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Metadata grid */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 16px",
          marginBottom: 18,
          fontSize: 12,
        }}
      >
        <div>
          <span style={{ color: "#888", marginRight: 4 }}>Location:</span>
          <span style={{ color: "#111", fontWeight: 600 }}>
            {incident.caller_address || incident.caller_location}
          </span>
        </div>
        <div>
          <span style={{ color: "#888", marginRight: 4 }}>Caller:</span>
          <span style={{ color: "#111", fontFamily: "monospace" }}>{incident.caller_id}</span>
        </div>
        {incident.resolved_at && (
          <div>
            <span style={{ color: "#888", marginRight: 4 }}>Resolved:</span>
            <span style={{ color: "#111" }}>
              {new Date(incident.resolved_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* AI summary */}
      {incident.summary && (
        <div
          style={{
            background: "#f7f7f7",
            border: "1px solid #e0e0e0",
            borderRadius: 5,
            padding: "10px 14px",
            marginBottom: 18,
            fontSize: 13,
            color: "#222",
            lineHeight: 1.6,
          }}
        >
          <span style={{ fontWeight: 700, color: "#000", marginRight: 6 }}>Summary:</span>
          {incident.summary}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Dispatch panel */}
      {/* ------------------------------------------------------------------ */}
      {incident.status === "active" && (
        <div
          style={{
            border: "1px solid #ccc",
            borderRadius: 5,
            padding: "12px 14px",
            marginBottom: 18,
          }}
        >
          <SectionHeader title="Dispatch Unit" />
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              style={{
                flex: 1,
                background: "#fff",
                color: "#111",
                border: "1px solid #ccc",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 12,
                outline: "none",
              }}
            >
              <option value="">Select available unit…</option>
              {availableUnits.map((u) => (
                <option key={u.id} value={u.type}>
                  {u.unit_code} ({u.type})
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleDispatch()}
              disabled={!selectedUnit || dispatching}
              style={{
                background: selectedUnit ? "#000" : "#e0e0e0",
                color: selectedUnit ? "#fff" : "#999",
                border: "none",
                borderRadius: 4,
                padding: "6px 18px",
                fontSize: 12,
                cursor: selectedUnit ? "pointer" : "not-allowed",
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              {dispatching ? "Dispatching…" : "Dispatch"}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Dispatched units list */}
      {/* ------------------------------------------------------------------ */}
      {dispatches.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionHeader title="Dispatched Units" />
          {dispatches.map((d) => {
            const unit = units.find((u) => u.id === d.unit_id);
            return (
              <div
                key={d.id}
                style={{
                  fontSize: 12,
                  color: "#333",
                  padding: "5px 0",
                  borderBottom: "1px solid #f0f0f0",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {unit?.unit_code ?? d.unit_id.slice(0, 8)}
                </span>
                <span style={{ color: "#888", fontFamily: "monospace" }}>
                  dispatched {new Date(d.dispatched_at).toLocaleTimeString()}
                  {d.arrived_at && (
                    <span style={{ color: "#333", marginLeft: 8 }}>
                      · arrived {new Date(d.arrived_at).toLocaleTimeString()}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tabs: Report / Transcript */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e5e5", marginBottom: 16 }}>
        {(["report", "transcript"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: activeTab === tab ? 700 : 500,
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #000" : "2px solid transparent",
              marginBottom: -2,
              color: activeTab === tab ? "#000" : "#888",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {tab === "report" ? "AI Report" : "Transcript"}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* AI Report tab */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "report" && (
        <div>
          {!report ? (
            <p style={{ color: "#aaa", fontSize: 13 }}>
              No report generated yet. Reports are created every 30 seconds once a call is active.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Summary */}
              <div>
                <SectionHeader title="Summary" />
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "#222",
                    lineHeight: 1.6,
                    background: "#f7f7f7",
                    border: "1px solid #eee",
                    borderRadius: 4,
                    padding: "10px 12px",
                  }}
                >
                  {report.summary}
                </p>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 4, fontFamily: "monospace" }}>
                  Generated: {new Date(report.generated_at).toLocaleString()}
                </div>
              </div>

              {/* Caller details */}
              {report.caller_details && (
                <div>
                  <SectionHeader title="Caller Details" />
                  <p style={{ margin: 0, fontSize: 13, color: "#444", lineHeight: 1.5 }}>
                    {report.caller_details}
                  </p>
                </div>
              )}

              {/* Recommended actions */}
              {report.recommended_actions.length > 0 && (
                <div>
                  <SectionHeader title="Recommended Actions" />
                  <ol style={{ margin: 0, padding: "0 0 0 18px" }}>
                    {report.recommended_actions.map((action, i) => (
                      <li
                        key={i}
                        style={{ fontSize: 13, color: "#222", marginBottom: 4, lineHeight: 1.5 }}
                      >
                        {action}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Dispatcher assigned */}
              {report.dispatcher_assigned && (
                <div>
                  <SectionHeader title="Assigned Dispatcher" />
                  <div
                    style={{
                      background: "#f7f7f7",
                      border: "1px solid #eee",
                      borderRadius: 4,
                      padding: "10px 12px",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#000", marginBottom: 3 }}>
                      {report.dispatcher_assigned.name}
                      <span style={{ fontWeight: 400, color: "#777", marginLeft: 8 }}>
                        {report.dispatcher_assigned.badge} · {report.dispatcher_assigned.desk}
                      </span>
                    </div>
                    <div style={{ color: "#666" }}>
                      {report.dispatcher_assigned.certifications.join(" · ")}
                    </div>
                  </div>
                </div>
              )}

              {/* Units dispatched */}
              {report.units_dispatched.length > 0 && (
                <div>
                  <SectionHeader title="Units Dispatched" />
                  {report.units_dispatched.map((u, i) => (
                    <div
                      key={i}
                      style={{
                        border: "1px solid #e5e5e5",
                        borderRadius: 4,
                        padding: "8px 12px",
                        marginBottom: 6,
                        fontSize: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 3,
                        }}
                      >
                        <span style={{ fontWeight: 700, color: "#000", fontFamily: "monospace" }}>
                          {u.unit_code}
                        </span>
                        <span style={{ color: "#555" }}>
                          {u.distance_km.toFixed(1)} km · ~{u.eta_minutes} min ETA
                        </span>
                      </div>
                      <div style={{ color: "#666" }}>
                        Lead: {u.crew_lead}
                        {u.crew.length > 1 && (
                          <span style={{ marginLeft: 8, color: "#aaa" }}>
                            +{u.crew.length - 1} crew
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Timeline */}
              {report.timeline.length > 0 && (
                <div>
                  <SectionHeader title="Timeline" />
                  <div
                    style={{
                      borderLeft: "2px solid #e5e5e5",
                      paddingLeft: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {report.timeline.map((ev, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#333", lineHeight: 1.5 }}>
                        <span
                          style={{
                            fontFamily: "monospace",
                            color: "#999",
                            marginRight: 8,
                            fontSize: 11,
                          }}
                        >
                          {Math.floor(ev.timestamp_ms / 1000)}s
                        </span>
                        {ev.event}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Transcript tab */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "transcript" && (
        <div>
          {turns.length === 0 ? (
            <p style={{ color: "#aaa", fontSize: 13 }}>No transcript yet.</p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {turns.map((t) => {
                const isAgent = t.role === "agent";
                return (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      flexDirection: isAgent ? "row-reverse" : "row",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#fff",
                        background: isAgent ? "#000" : "#555",
                        borderRadius: 3,
                        padding: "2px 6px",
                        minWidth: 32,
                        textAlign: "center",
                        flexShrink: 0,
                        marginTop: 2,
                        letterSpacing: 0.5,
                      }}
                    >
                      {isAgent ? "AI" : "911"}
                    </span>
                    <div
                      style={{
                        background: isAgent ? "#f0f0f0" : "#fff",
                        border: "1px solid #ddd",
                        borderRadius: 6,
                        padding: "8px 12px",
                        fontSize: 13,
                        color: "#111",
                        maxWidth: "78%",
                        lineHeight: 1.55,
                      }}
                    >
                      {t.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
