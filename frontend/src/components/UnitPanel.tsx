/**
 * UnitPanel — rich unit cards showing status, zone, distance from incident,
 * crew, vehicle, and equipment. White/black theme with semantic status dots.
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
// Semantic status dot colours (kept intentionally coloured for quick scanning)
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<string, string> = {
  available:  "#16a34a",
  dispatched: "#f97316",
  on_scene:   "#3b82f6",
  returning:  "#a78bfa",
};

const STATUS_LABEL: Record<string, string> = {
  available:  "AVAILABLE",
  dispatched: "DISPATCHED",
  on_scene:   "ON SCENE",
  returning:  "RETURNING",
};

const TYPE_ICONS: Record<string, string> = {
  ems:     "EMS",
  fire:    "FIRE",
  police:  "PD",
  hazmat:  "HZM",
  rescue:  "SAR",
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

  const displayUnits = mockUnits.length > 0 ? mockUnits : units.map(dbUnitToMock);

  const toggleExpand = (code: string) =>
    setExpanded((prev) => (prev === code ? null : code));

  return (
    <div>
      {loadingMock && (
        <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8 }}>
          Calculating distances…
        </div>
      )}

      {displayUnits.map((u) => {
        const dotColor = STATUS_DOT[u.status] ?? "#aaa";
        const isExpanded = expanded === u.unit_code;

        return (
          <div
            key={u.unit_code}
            onClick={() => toggleExpand(u.unit_code)}
            style={{
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 6,
              padding: "9px 11px",
              marginBottom: 7,
              cursor: "pointer",
              transition: "border-color 0.15s, box-shadow 0.15s",
              boxShadow: isExpanded ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {/* Unit header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Status dot */}
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: dotColor,
                  flexShrink: 0,
                }}
              />

              {/* Type chip */}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#555",
                  background: "#f0f0f0",
                  border: "1px solid #ddd",
                  borderRadius: 3,
                  padding: "1px 5px",
                  fontFamily: "monospace",
                  letterSpacing: 0.5,
                  flexShrink: 0,
                }}
              >
                {TYPE_ICONS[u.type] ?? u.type.toUpperCase()}
              </span>

              {/* Unit code + status */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 12,
                      color: "#000",
                      fontFamily: "monospace",
                    }}
                  >
                    {u.unit_code}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: dotColor,
                      letterSpacing: 0.3,
                    }}
                  >
                    {STATUS_LABEL[u.status] ?? u.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#aaa", marginTop: 1 }}>
                  {u.zone}
                  {u.crew.length > 0 && (
                    <span style={{ marginLeft: 6 }}>{u.crew.length} crew</span>
                  )}
                </div>
              </div>

              {/* Distance / ETA */}
              {incidentLocation && u.distance_km > 0 && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>
                    {u.distance_km.toFixed(1)} km
                  </div>
                  <div style={{ fontSize: 10, color: "#888" }}>
                    ~{u.eta_minutes} min
                  </div>
                </div>
              )}

              <span style={{ fontSize: 10, color: "#ccc", flexShrink: 0 }}>
                {isExpanded ? "▲" : "▼"}
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid #eeeeee",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {/* Vehicle */}
                {u.vehicle && u.vehicle.make !== "—" && (
                  <div style={{ fontSize: 11, color: "#555" }}>
                    <span style={{ color: "#aaa", marginRight: 4 }}>Vehicle:</span>
                    {u.vehicle.year} {u.vehicle.make} {u.vehicle.model}
                    <span style={{ marginLeft: 6, color: "#bbb", fontFamily: "monospace" }}>
                      {u.vehicle.license}
                    </span>
                  </div>
                )}

                {/* Crew */}
                {u.crew.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#aaa",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                        marginBottom: 3,
                      }}
                    >
                      Crew
                    </div>
                    {u.crew.map((c, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#333", lineHeight: 1.6 }}>
                        {c.name}
                        <span style={{ color: "#aaa", marginLeft: 4 }}>— {c.role}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Equipment */}
                {u.equipment.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#aaa",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                        marginBottom: 4,
                      }}
                    >
                      Equipment
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {u.equipment.map((eq) => (
                        <span
                          key={eq}
                          style={{
                            fontSize: 10,
                            background: "#f5f5f5",
                            border: "1px solid #e0e0e0",
                            borderRadius: 3,
                            padding: "2px 6px",
                            color: "#555",
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
                  <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>
                    Assigned: #{u.current_incident_id.slice(0, 8)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {displayUnits.length === 0 && (
        <div style={{ fontSize: 12, color: "#ccc", textAlign: "center", paddingTop: 20 }}>
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
