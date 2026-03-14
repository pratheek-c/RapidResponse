/**
 * UnitPanel — rich unit cards showing status, zone, distance from incident,
 * crew, vehicle, and equipment. Fetches from /units/mock when incident coords
 * are available, falls back to the basic /units list otherwise.
 */
import { useState, useEffect, useCallback } from "react";
import type { Unit } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ---------------------------------------------------------------------------
// Types for mock unit data
// ---------------------------------------------------------------------------

type MockCrewMember = {
  name: string;
  role: string;
};

type MockVehicle = {
  make: string;
  model: string;
  year: number;
  license: string;
};

type MockCoords = { lat: number; lng: number };

type MockUnit = {
  unit_code: string;
  type: string;
  status: string;
  zone: string;
  station: string;
  station_coords: MockCoords;
  current_coords: MockCoords;
  current_incident_id: string | null;
  crew: MockCrewMember[];
  vehicle: MockVehicle;
  equipment: string[];
  distance_km: number;
  eta_minutes: number;
};

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  available:  { bg: "#0a1f0f", border: "#16a34a", text: "#22c55e" },
  dispatched: { bg: "#1a0f00", border: "#c2410c", text: "#f97316" },
  on_scene:   { bg: "#0d1a2e", border: "#1d4ed8", text: "#3b82f6" },
  returning:  { bg: "#1a0d2e", border: "#7c3aed", text: "#a78bfa" },
};

const TYPE_ICONS: Record<string, string> = {
  ems:     "🚑",
  fire:    "🚒",
  police:  "🚔",
  hazmat:  "☣",
  rescue:  "🛟",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  units: Unit[];
  incidentLocation: string | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnitPanel({ units, incidentLocation }: Props) {
  const [mockUnits, setMockUnits] = useState<MockUnit[]>([]);
  const [loadingMock, setLoadingMock] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchMock = useCallback(async (lat: number, lng: number) => {
    setLoadingMock(true);
    try {
      const res = await fetch(`${API_BASE}/units/mock?lat=${lat}&lng=${lng}`);
      if (!res.ok) return;
      const json = (await res.json()) as { ok: boolean; data: MockUnit[] };
      if (json.ok) setMockUnits(json.data);
    } catch {
      // non-fatal
    } finally {
      setLoadingMock(false);
    }
  }, []);

  useEffect(() => {
    if (!incidentLocation) {
      // No incident selected — fetch without coords to get all mock units
      fetch(`${API_BASE}/units/mock`)
        .then((r) => r.json())
        .then((j: { ok: boolean; data: MockUnit[] }) => {
          if (j.ok) setMockUnits(j.data);
        })
        .catch(() => undefined);
      return;
    }
    const parts = incidentLocation.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      void fetchMock(parts[0], parts[1]);
    }
  }, [incidentLocation, fetchMock]);

  // Use mock data if available, else fall back to basic DB units
  const displayUnits = mockUnits.length > 0 ? mockUnits : units.map(dbUnitToMock);

  const toggleExpand = (code: string) =>
    setExpanded((prev) => (prev === code ? null : code));

  return (
    <div>
      {loadingMock && (
        <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
          Calculating distances…
        </div>
      )}

      {displayUnits.map((u) => {
        const style = STATUS_COLORS[u.status] ?? STATUS_COLORS.available;
        const isExpanded = expanded === u.unit_code;

        return (
          <div
            key={u.unit_code}
            onClick={() => toggleExpand(u.unit_code)}
            style={{
              background: style.bg,
              border: `1px solid ${style.border}`,
              borderRadius: 10,
              padding: "10px 12px",
              marginBottom: 8,
              cursor: "pointer",
              transition: "border-color 0.15s",
            }}
          >
            {/* Unit header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{TYPE_ICONS[u.type] ?? "🚨"}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>
                    {u.unit_code}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: style.text,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {u.status.replace("_", " ")}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                  {u.zone}
                  {u.crew.length > 0 && (
                    <span style={{ marginLeft: 6 }}>· {u.crew.length} crew</span>
                  )}
                </div>
              </div>

              {/* Distance badge */}
              {incidentLocation && u.distance_km > 0 && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                    {u.distance_km.toFixed(1)} km
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    ~{u.eta_minutes} min
                  </div>
                </div>
              )}

              <span style={{ fontSize: 10, color: "#334155", flexShrink: 0 }}>
                {isExpanded ? "▲" : "▼"}
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${style.border}` }}>
                {/* Vehicle */}
                {u.vehicle && (
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                    <span style={{ color: "#64748b" }}>Vehicle: </span>
                    {u.vehicle.year} {u.vehicle.make} {u.vehicle.model}
                    <span style={{ marginLeft: 6, color: "#475569" }}>({u.vehicle.license})</span>
                  </div>
                )}

                {/* Crew */}
                {u.crew.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Crew
                    </div>
                    {u.crew.map((c, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
                        {c.name}
                        <span style={{ color: "#475569" }}> — {c.role}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Equipment */}
                {u.equipment.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Equipment
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {u.equipment.map((eq) => (
                        <span
                          key={eq}
                          style={{
                            fontSize: 10,
                            background: "#111827",
                            border: "1px solid #1e2433",
                            borderRadius: 4,
                            padding: "2px 6px",
                            color: "#64748b",
                          }}
                        >
                          {eq}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Current incident */}
                {u.current_incident_id && (
                  <div style={{ marginTop: 6, fontSize: 11, color: style.text }}>
                    Assigned: #{u.current_incident_id.slice(0, 8)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {displayUnits.length === 0 && (
        <div style={{ fontSize: 12, color: "#334155", textAlign: "center", paddingTop: 20 }}>
          No units available
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: convert basic DB Unit to MockUnit shape for fallback display
// ---------------------------------------------------------------------------

function dbUnitToMock(u: Unit): MockUnit {
  return {
    unit_code: u.unit_code,
    type: u.type,
    status: u.status,
    zone: "—",
    station: "—",
    station_coords: { lat: 0, lng: 0 },
    current_coords: { lat: 0, lng: 0 },
    current_incident_id: u.current_incident_id,
    crew: [],
    vehicle: { make: "—", model: "—", year: 0, license: "—" },
    equipment: [],
    distance_km: 0,
    eta_minutes: 0,
  };
}
