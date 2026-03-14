import type { Incident } from "@/types";
import { PriorityBadge, StatusBadge, TypeChip } from "./Badges";

type Props = {
  incidents: Incident[];
  onSelect: (id: string) => void;
  selectedId: string | null;
};

export function IncidentList({ incidents, onSelect, selectedId }: Props) {
  if (incidents.length === 0) {
    return (
      <p style={{ color: "#6b7280", padding: "16px", textAlign: "center" }}>
        No active incidents
      </p>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {incidents.map((inc) => (
        <li
          key={inc.id}
          onClick={() => onSelect(inc.id)}
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #1e2433",
            cursor: "pointer",
            background: selectedId === inc.id ? "#1a2235" : "transparent",
            transition: "background 0.15s",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13, color: "#94a3b8" }}>
              #{inc.id.slice(0, 8)}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {inc.priority && <PriorityBadge priority={inc.priority} />}
              <StatusBadge status={inc.status} />
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 4 }}>
            {inc.caller_location}
          </div>
          {inc.type && <TypeChip type={inc.type} />}
          <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
            {new Date(inc.created_at).toLocaleTimeString()}
          </div>
        </li>
      ))}
    </ul>
  );
}
