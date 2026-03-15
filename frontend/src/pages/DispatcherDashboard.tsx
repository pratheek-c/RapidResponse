/**
 * DispatcherDashboard — full white/black theme
 *
 * Layout:
 *   Row 1 (48px):  nav bar
 *   Row 2 (44px):  stats bar
 *   Row 3 (fill):  3-column — incident list | detail | dispatchers + units
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useIncidents } from "@/hooks/useIncidents";
import { useUnits } from "@/hooks/useUnits";
import { IncidentList } from "@/components/IncidentList";
import { IncidentDetail } from "@/components/IncidentDetail";
import { UnitPanel } from "@/components/UnitPanel";
import type { Incident, IncidentStatus } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ---------------------------------------------------------------------------
// Types imported from mock data
// ---------------------------------------------------------------------------

type MockDispatcher = {
  id: string;
  badge: string;
  name: string;
  shift: string;
  role: string;
  certifications: string[];
  station: { desk: string };
  assigned_zones: string[];
  status: "on_duty" | "off_duty";
};

type MockZone = {
  id: string;
  name: string;
  risk_level: "high" | "medium" | "low";
  primary_units: string[];
};

type MockData = {
  dispatchers: MockDispatcher[];
  zones: MockZone[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RISK_COLORS: Record<string, { bg: string; color: string }> = {
  high:   { bg: "#000", color: "#fff" },
  medium: { bg: "#555", color: "#fff" },
  low:    { bg: "#e8e8e8", color: "#555" },
};

function statsBg(label: string): { bg: string; color: string } {
  if (label === "Active") return { bg: "#000", color: "#fff" };
  return { bg: "#f5f5f5", color: "#111" };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatsTile({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  const { bg, color } = statsBg(label);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color,
        borderRight: "1px solid #e5e5e5",
        padding: "0 24px",
        minWidth: 100,
        height: "100%",
      }}
    >
      <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{value}</span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.8,
          marginTop: 2,
          opacity: 0.7,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function DispatcherCard({ d }: { d: MockDispatcher }) {
  const isOnDuty = d.status === "on_duty";
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 5,
        padding: "9px 11px",
        marginBottom: 7,
        background: isOnDuty ? "#fff" : "#fafafa",
        opacity: isOnDuty ? 1 : 0.55,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
        {/* On-duty indicator dot */}
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isOnDuty ? "#16a34a" : "#ccc",
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 12, color: "#000" }}>{d.name}</span>
        <span
          style={{
            fontSize: 10,
            color: "#aaa",
            fontFamily: "monospace",
            marginLeft: "auto",
          }}
        >
          {d.badge}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 3 }}>
        {d.station.desk} ·{" "}
        {d.role === "senior_dispatcher" ? "Senior Dispatcher" : "Dispatcher"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 3 }}>
        {d.assigned_zones.map((z) => (
          <span
            key={z}
            style={{
              fontSize: 9,
              fontWeight: 600,
              background: "#f0f0f0",
              border: "1px solid #ddd",
              borderRadius: 3,
              padding: "1px 5px",
              color: "#555",
              fontFamily: "monospace",
            }}
          >
            {z}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {d.certifications.map((c) => (
          <span
            key={c}
            style={{
              fontSize: 9,
              background: "#000",
              color: "#fff",
              borderRadius: 3,
              padding: "1px 5px",
              letterSpacing: 0.3,
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function ZoneChip({ zone }: { zone: MockZone }) {
  const { bg, color } = RISK_COLORS[zone.risk_level] ?? RISK_COLORS.low;
  return (
    <div
      title={`${zone.name} — Risk: ${zone.risk_level}`}
      style={{
        background: bg,
        color,
        borderRadius: 4,
        padding: "3px 8px",
        fontSize: 10,
        fontWeight: 700,
        fontFamily: "monospace",
        letterSpacing: 0.5,
        cursor: "default",
        userSelect: "none",
      }}
    >
      {zone.id}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state for main panel
// ---------------------------------------------------------------------------

function EmptyState({ incidents }: { incidents: Incident[] }) {
  const active = incidents.filter((i) =>
    (["active", "classified"] as IncidentStatus[]).includes(i.status)
  ).length;
  const dispatched = incidents.filter((i) =>
    (["dispatched", "en_route", "on_scene"] as IncidentStatus[]).includes(i.status)
  ).length;
  const resolved = incidents.filter((i) =>
    (["resolved", "completed"] as IncidentStatus[]).includes(i.status)
  ).length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "#fafafa",
        color: "#ccc",
        gap: 24,
      }}
    >
      <div style={{ fontSize: 13, color: "#bbb", letterSpacing: 2, fontWeight: 700 }}>
        SPRINGFIELD EMERGENCY COMMUNICATIONS CENTER
      </div>
      <div style={{ display: "flex", gap: 32 }}>
        {[
          { label: "Active", value: active },
          { label: "Dispatched", value: dispatched },
          { label: "Resolved", value: resolved },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: value > 0 ? "#000" : "#ddd" }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: "#aaa", letterSpacing: 1 }}>{label.toUpperCase()}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 13, color: "#ccc" }}>Select an incident to view details</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function DispatcherDashboard() {
  const { incidents, connected, extractions, escalations } = useIncidents();
  const { units, refetch: refetchUnits } = useUnits();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mockData, setMockData] = useState<MockData | null>(null);

  const selectedIncident = incidents.find((i) => i.id === selectedId) ?? null;

  // Load dispatcher/zone mock data
  useEffect(() => {
    fetch(`${API_BASE}/mock/dispatchers`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: MockData }) => {
        if (j.ok) setMockData(j.data);
      })
      .catch(() => undefined);
  }, []);

  const handleDispatch = async (incidentId: string, unitIds: string[], officerId: string) => {
    try {
      await fetch(`${API_BASE}/dispatch/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: incidentId, unit_ids: unitIds, officer_id: officerId }),
      });
      await refetchUnits();
    } catch {
      // non-fatal
    }
  };

  // Stats — cover all expanded statuses
  const activeCount = incidents.filter((i) =>
    (["active", "classified"] as IncidentStatus[]).includes(i.status)
  ).length;
  const dispatchedCount = incidents.filter((i) =>
    (["dispatched", "en_route", "on_scene"] as IncidentStatus[]).includes(i.status)
  ).length;
  const resolvedCount = incidents.filter((i) =>
    (["resolved", "completed"] as IncidentStatus[]).includes(i.status)
  ).length;
  const availableUnits = units.filter((u) => u.status === "available").length;

  const onDutyDispatchers = mockData?.dispatchers.filter((d) => d.status === "on_duty") ?? [];
  const offDutyDispatchers = mockData?.dispatchers.filter((d) => d.status === "off_duty") ?? [];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "48px 44px 1fr",
        gridTemplateColumns: "280px 1fr 300px",
        height: "100vh",
        overflow: "hidden",
        background: "#fff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* ================================================================== */}
      {/* NAV BAR */}
      {/* ================================================================== */}
      <header
        style={{
          gridColumn: "1 / -1",
          background: "#000",
          borderBottom: "1px solid #222",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: 16,
              color: "#fff",
              letterSpacing: -0.3,
            }}
          >
            RapidResponse.ai
          </span>
          <span
            style={{
              fontSize: 10,
              background: "#111",
              border: "1px solid #333",
              color: "#aaa",
              borderRadius: 3,
              padding: "2px 8px",
              letterSpacing: 0.5,
              fontWeight: 600,
            }}
          >
            DISPATCHER
          </span>
          {/* Zone chips */}
          {mockData?.zones && (
            <div style={{ display: "flex", gap: 5, marginLeft: 8 }}>
              {mockData.zones.map((z) => (
                <ZoneChip key={z.id} zone={z} />
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              fontSize: 11,
              color: connected ? "#4ade80" : "#f87171",
              fontWeight: 600,
              letterSpacing: 0.3,
            }}
          >
            {connected ? "● LIVE" : "● DISCONNECTED"}
          </span>
          <Link
            to="/"
            style={{
              background: "#ef4444",
              color: "#fff",
              textDecoration: "none",
              borderRadius: 4,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.3,
            }}
          >
            Simulate 911 Call
          </Link>
        </div>
      </header>

      {/* ================================================================== */}
      {/* STATS BAR */}
      {/* ================================================================== */}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          borderBottom: "1px solid #e5e5e5",
          background: "#fff",
          overflow: "hidden",
        }}
      >
        <StatsTile label="Active" value={activeCount} />
        <StatsTile label="Dispatched" value={dispatchedCount} />
        <StatsTile label="Resolved" value={resolvedCount} />
        <StatsTile label="Avail. Units" value={availableUnits} />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            fontSize: 11,
            color: "#bbb",
            letterSpacing: 0.5,
          }}
        >
          Springfield Emergency Communications Center · Day Shift
        </div>
      </div>

      {/* ================================================================== */}
      {/* LEFT — Incident list */}
      {/* ================================================================== */}
      <aside
        style={{
          borderRight: "1px solid #e5e5e5",
          overflowY: "auto",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid #e5e5e5",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 1.5,
              color: "#555",
              textTransform: "uppercase",
            }}
          >
            Incidents
          </span>
          <span
            style={{
              background: "#000",
              color: "#fff",
              borderRadius: 10,
              padding: "1px 8px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {incidents.length}
          </span>
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <IncidentList
            incidents={incidents}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />
        </div>
      </aside>

      {/* ================================================================== */}
      {/* CENTRE — Incident detail */}
      {/* ================================================================== */}
      <main style={{ overflowY: "auto", background: "#fff" }}>
        {selectedIncident ? (
          <IncidentDetail
            incident={selectedIncident}
            units={units}
            onDispatch={handleDispatch}
            extraction={selectedIncident ? (extractions[selectedIncident.id] ?? null) : null}
            escalation={selectedIncident ? (escalations[selectedIncident.id] ?? null) : null}
          />
        ) : (
          <EmptyState incidents={incidents} />
        )}
      </main>

      {/* ================================================================== */}
      {/* RIGHT — Dispatchers + Units */}
      {/* ================================================================== */}
      <aside
        style={{
          borderLeft: "1px solid #e5e5e5",
          overflowY: "auto",
          background: "#fff",
        }}
      >
        {/* ----- Dispatchers section ----- */}
        <div
          style={{
            padding: "10px 12px 0",
            borderBottom: "1px solid #eeeeee",
            paddingBottom: 12,
            marginBottom: 0,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
              color: "#555",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Dispatchers
          </div>

          {onDutyDispatchers.length === 0 && offDutyDispatchers.length === 0 && (
            <div style={{ fontSize: 12, color: "#ccc", textAlign: "center", paddingBottom: 12 }}>
              Loading…
            </div>
          )}

          {onDutyDispatchers.map((d) => (
            <DispatcherCard key={d.id} d={d} />
          ))}

          {offDutyDispatchers.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 9,
                  color: "#ccc",
                  fontWeight: 600,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  margin: "8px 0 6px",
                }}
              >
                Off Duty
              </div>
              {offDutyDispatchers.map((d) => (
                <DispatcherCard key={d.id} d={d} />
              ))}
            </>
          )}
        </div>

        {/* ----- Units section ----- */}
        <div style={{ padding: "10px 12px" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
              color: "#555",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Units
          </div>
          <UnitPanel
            units={units}
            incidentLocation={selectedIncident?.caller_location ?? null}
          />
        </div>
      </aside>
    </div>
  );
}
