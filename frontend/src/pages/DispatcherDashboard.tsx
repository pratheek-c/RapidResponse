import { useState } from "react";
import { useIncidents } from "@/hooks/useIncidents";
import { useUnits } from "@/hooks/useUnits";
import { IncidentList } from "@/components/IncidentList";
import { IncidentDetail } from "@/components/IncidentDetail";
import { UnitPanel } from "@/components/UnitPanel";
import { Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function DispatcherDashboard() {
  const { incidents, connected } = useIncidents();
  const { units, refetch: refetchUnits } = useUnits();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedIncident = incidents.find((i) => i.id === selectedId) ?? null;

  const handleDispatch = async (incidentId: string, unitId: string) => {
    try {
      await fetch(`${API_BASE}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: incidentId, unit_id: unitId }),
      });
      await refetchUnits();
    } catch {
      // non-fatal — operator can retry
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "56px 1fr",
        gridTemplateColumns: "280px 1fr 260px",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <header
        style={{
          gridColumn: "1 / -1",
          background: "#0d1117",
          borderBottom: "1px solid #1e2433",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: 18,
              color: "#f8fafc",
              letterSpacing: -0.5,
            }}
          >
            RapidResponse.ai
          </span>
          <span
            style={{
              fontSize: 11,
              color: connected ? "#22c55e" : "#ef4444",
              fontWeight: 600,
            }}
          >
            {connected ? "● LIVE" : "● DISCONNECTED"}
          </span>
        </div>
        <Link
          to="/call"
          style={{
            background: "#ef4444",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 6,
            padding: "6px 16px",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Simulate 911 Call
        </Link>
      </header>

      {/* Incident list sidebar */}
      <aside
        style={{
          borderRight: "1px solid #1e2433",
          overflowY: "auto",
          background: "#0a0c10",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #1e2433",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13, color: "#94a3b8" }}>
            INCIDENTS
          </span>
          <span
            style={{
              background: "#1e2433",
              borderRadius: 10,
              padding: "2px 8px",
              fontSize: 11,
              color: "#64748b",
            }}
          >
            {incidents.length}
          </span>
        </div>
        <IncidentList
          incidents={incidents}
          onSelect={setSelectedId}
          selectedId={selectedId}
        />
      </aside>

      {/* Main content — incident detail */}
      <main style={{ overflowY: "auto", background: "#0a0c10" }}>
        {selectedIncident ? (
          <IncidentDetail
            incident={selectedIncident}
            units={units}
            onDispatch={handleDispatch}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#334155",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
            <p style={{ fontSize: 16, fontWeight: 600 }}>
              Select an incident to view details
            </p>
          </div>
        )}
      </main>

      {/* Unit panel sidebar */}
      <aside
        style={{
          borderLeft: "1px solid #1e2433",
          overflowY: "auto",
          background: "#0a0c10",
          padding: 16,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: "#94a3b8",
            marginBottom: 16,
            letterSpacing: 1,
          }}
        >
          UNITS
        </div>
        <UnitPanel units={units} />
      </aside>
    </div>
  );
}
