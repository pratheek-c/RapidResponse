import type { IncidentPriority, IncidentStatus, IncidentType } from "@/types";

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------
const PRIORITY_COLORS: Record<IncidentPriority, string> = {
  P1: "#ef4444",
  P2: "#f97316",
  P3: "#eab308",
  P4: "#6b7280",
};

export function PriorityBadge({ priority }: { priority: IncidentPriority }) {
  return (
    <span
      style={{
        background: PRIORITY_COLORS[priority],
        color: "#fff",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 1,
      }}
    >
      {priority}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<IncidentStatus, string> = {
  active: "#22c55e",
  dispatched: "#3b82f6",
  resolved: "#6b7280",
  cancelled: "#374151",
};

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <span
      style={{
        background: STATUS_COLORS[status],
        color: "#fff",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 1,
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Incident type chip
// ---------------------------------------------------------------------------
const TYPE_ICONS: Record<IncidentType, string> = {
  fire: "🔥",
  medical: "🚑",
  police: "👮",
  traffic: "🚗",
  hazmat: "☣️",
  search_rescue: "🔍",
  other: "📋",
};

export function TypeChip({ type }: { type: IncidentType }) {
  return (
    <span style={{ fontSize: 13 }}>
      {TYPE_ICONS[type]} {type.replace("_", " ")}
    </span>
  );
}
