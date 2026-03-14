import type { Unit } from "@/types";

const STATUS_COLOR: Record<Unit["status"], string> = {
  available: "#22c55e",
  dispatched: "#f97316",
  on_scene: "#3b82f6",
  returning: "#a78bfa",
};

type Props = { units: Unit[] };

export function UnitPanel({ units }: Props) {
  const byType = units.reduce<Record<string, Unit[]>>((acc, u) => {
    (acc[u.type] ??= []).push(u);
    return acc;
  }, {});

  return (
    <div>
      {Object.entries(byType).map(([type, list]) => (
        <div key={type} style={{ marginBottom: 16 }}>
          <h4
            style={{
              margin: "0 0 6px",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#64748b",
            }}
          >
            {type}
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {list.map((u) => (
              <div
                key={u.id}
                title={`Status: ${u.status}${u.current_incident_id ? ` | Incident: #${u.current_incident_id.slice(0, 8)}` : ""}`}
                style={{
                  background: "#111827",
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#e2e8f0",
                  border: `2px solid ${STATUS_COLOR[u.status]}`,
                  cursor: "default",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: STATUS_COLOR[u.status],
                    marginRight: 5,
                    verticalAlign: "middle",
                  }}
                />
                {u.unit_code}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
