import type { IncidentPriority, IncidentStatus, IncidentType } from "@/types";

// ---------------------------------------------------------------------------
// Priority badge — white/black theme
// P1: solid black background, white text
// P2: dark grey (#333)
// P3: medium grey (#666)
// P4: light grey (#999), black text
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<IncidentPriority, { bg: string; color: string; border: string }> = {
  P1: { bg: "#000000", color: "#ffffff", border: "#000000" },
  P2: { bg: "#333333", color: "#ffffff", border: "#333333" },
  P3: { bg: "#666666", color: "#ffffff", border: "#666666" },
  P4: { bg: "#f0f0f0", color: "#333333", border: "#999999" },
};

export function PriorityBadge({ priority }: { priority: IncidentPriority }) {
  const s = PRIORITY_STYLES[priority];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        borderRadius: 3,
        padding: "2px 7px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        fontFamily: "monospace",
      }}
    >
      {priority}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status badge — outlined pill, black border
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<IncidentStatus, string> = {
  active:     "ACTIVE",
  classified: "CLASSIFIED",
  dispatched: "DISPATCHED",
  en_route:   "EN ROUTE",
  on_scene:   "ON SCENE",
  completed:  "COMPLETED",
  resolved:   "RESOLVED",
  cancelled:  "CANCELLED",
};

const STATUS_STYLES: Record<IncidentStatus, { bg: string; color: string; border: string }> = {
  active:     { bg: "#000000", color: "#ffffff", border: "#000000" },
  classified: { bg: "#222222", color: "#ffffff", border: "#222222" },
  dispatched: { bg: "#444444", color: "#ffffff", border: "#444444" },
  en_route:   { bg: "#555555", color: "#ffffff", border: "#555555" },
  on_scene:   { bg: "#333333", color: "#ffffff", border: "#333333" },
  completed:  { bg: "#f0f0f0", color: "#444444", border: "#cccccc" },
  resolved:   { bg: "#f0f0f0", color: "#666666", border: "#cccccc" },
  cancelled:  { bg: "#f0f0f0", color: "#999999", border: "#cccccc" },
};

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        borderRadius: 3,
        padding: "2px 7px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.5,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Incident type chip — monochrome text label with ASCII icon
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<IncidentType, string> = {
  fire:         "DFB",
  medical:      "NAS",
  police:       "GARDA",
  traffic:      "RTC",
  hazmat:       "HAZMAT",
  search_rescue: "SAR",
  other:        "OTHER",
};

export function TypeChip({ type }: { type: IncidentType }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "#444",
        background: "#f5f5f5",
        border: "1px solid #ddd",
        borderRadius: 3,
        padding: "2px 7px",
        letterSpacing: 0.5,
        fontFamily: "monospace",
      }}
    >
      {TYPE_ICONS[type]}
    </span>
  );
}
