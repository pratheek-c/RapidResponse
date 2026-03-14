import { useState, useEffect } from "react";
import type { Incident, TranscriptionTurn, Unit, Dispatch } from "@/types";
import { PriorityBadge, StatusBadge, TypeChip } from "./Badges";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type Props = {
  incident: Incident;
  units: Unit[];
  onDispatch: (incidentId: string, unitType: string) => Promise<void>;
};

export function IncidentDetail({ incident, units, onDispatch }: Props) {
  const [turns, setTurns] = useState<TranscriptionTurn[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [dispatching, setDispatching] = useState(false);

  useEffect(() => {
    setTurns([]);
    setDispatches([]);
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
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, color: "#f1f5f9" }}>
          Incident #{incident.id.slice(0, 8)}
        </h2>
        <StatusBadge status={incident.status} />
        {incident.priority && <PriorityBadge priority={incident.priority} />}
        {incident.type && <TypeChip type={incident.type} />}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        <div>
          <span style={{ color: "#64748b" }}>Location: </span>
          <span style={{ color: "#e2e8f0" }}>{incident.caller_location}</span>
        </div>
        <div>
          <span style={{ color: "#64748b" }}>Caller ID: </span>
          <span style={{ color: "#e2e8f0" }}>{incident.caller_id}</span>
        </div>
        <div>
          <span style={{ color: "#64748b" }}>Created: </span>
          <span style={{ color: "#e2e8f0" }}>
            {new Date(incident.created_at).toLocaleString()}
          </span>
        </div>
        {incident.resolved_at && (
          <div>
            <span style={{ color: "#64748b" }}>Resolved: </span>
            <span style={{ color: "#e2e8f0" }}>
              {new Date(incident.resolved_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {incident.summary && (
        <div
          style={{
            background: "#111827",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            color: "#cbd5e1",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "#94a3b8" }}>Summary: </strong>
          {incident.summary}
        </div>
      )}

      {/* Dispatch panel */}
      {incident.status === "active" && (
        <div
          style={{
            background: "#0f1624",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>
            Dispatch Unit
          </h3>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              style={{
                flex: 1,
                background: "#1e2433",
                color: "#e2e8f0",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 13,
              }}
            >
              <option value="">Select available unit...</option>
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
                background: selectedUnit ? "#3b82f6" : "#1e2433",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 16px",
                fontSize: 13,
                cursor: selectedUnit ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
            >
              {dispatching ? "Dispatching..." : "Dispatch"}
            </button>
          </div>
        </div>
      )}

      {/* Dispatched units */}
      {dispatches.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 13, color: "#94a3b8" }}>
            Dispatched Units
          </h3>
          {dispatches.map((d) => {
            const unit = units.find((u) => u.id === d.unit_id);
            return (
              <div
                key={d.id}
                style={{
                  fontSize: 13,
                  color: "#cbd5e1",
                  padding: "4px 0",
                  borderBottom: "1px solid #1e2433",
                }}
              >
                {unit?.unit_code ?? d.unit_id.slice(0, 8)} — dispatched{" "}
                {new Date(d.dispatched_at).toLocaleTimeString()}
                {d.arrived_at && (
                  <span style={{ color: "#22c55e" }}>
                    {" "}
                    · arrived {new Date(d.arrived_at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Transcript */}
      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: 13, color: "#94a3b8" }}>
          Transcript
        </h3>
        {turns.length === 0 ? (
          <p style={{ color: "#475569", fontSize: 13 }}>No transcript yet.</p>
        ) : (
          <div
            style={{
              maxHeight: 300,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {turns.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  flexDirection:
                    t.role === "agent" ? "row-reverse" : "row",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: t.role === "agent" ? "#3b82f6" : "#22c55e",
                    fontWeight: 700,
                    minWidth: 40,
                    textAlign: "center",
                    paddingTop: 3,
                  }}
                >
                  {t.role === "agent" ? "AI" : "911"}
                </span>
                <div
                  style={{
                    background:
                      t.role === "agent" ? "#1e3a5f" : "#14291e",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 13,
                    color: "#e2e8f0",
                    maxWidth: "80%",
                    lineHeight: 1.5,
                  }}
                >
                  {t.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
