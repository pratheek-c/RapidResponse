import type { DashboardIncident } from "@/types/dashboard";
import { SeverityBadge } from "@/components/common/SeverityBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { TimeAgo } from "@/components/common/TimeAgo";
import { useSession, canTakeIncident } from "@/context/SessionContext";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type IncidentCardProps = {
  incident: DashboardIncident;
  selected: boolean;
  onSelect: () => void;
};

const TYPE_LABELS: Record<string, string> = {
  fire: "DFB",
  medical: "NAS",
  police: "GARDA",
  traffic: "RTC",
  hazmat: "HAZMAT",
  search_rescue: "SAR",
  other: "OTHER",
};

const TYPE_COLORS: Record<string, string> = {
  fire: "border-orange-700/60 bg-orange-500/10 text-orange-200",
  medical: "border-emerald-700/60 bg-emerald-500/10 text-emerald-200",
  police: "border-blue-700/60 bg-blue-500/10 text-blue-200",
  traffic: "border-yellow-700/60 bg-yellow-500/10 text-yellow-200",
  hazmat: "border-purple-700/60 bg-purple-500/10 text-purple-200",
  search_rescue: "border-sky-700/60 bg-sky-500/10 text-sky-200",
  other: "border-slate-700/60 bg-slate-500/10 text-slate-300",
};

/** Returns true if the incident was created more than 8 minutes ago and is still active/classified */
function isOverdue(incident: DashboardIncident): boolean {
  if (incident.status !== "active" && incident.status !== "classified") return false;
  const ageMs = Date.now() - Date.parse(incident.created_at);
  return ageMs > 8 * 60 * 1000;
}

/** Returns a subtle left-border color class based on priority */
function priorityBorderClass(priority: DashboardIncident["priority"]): string {
  if (priority === "P1") return "border-l-red-500";
  if (priority === "P2") return "border-l-orange-500";
  if (priority === "P3") return "border-l-yellow-500";
  return "border-l-slate-700";
}

/** Returns parsed assigned unit IDs */
function getAssignedUnits(incident: DashboardIncident): string[] {
  if (!incident.assigned_units) return [];
  try {
    const parsed = JSON.parse(incident.assigned_units);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // fallback
  }
  return incident.assigned_units
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function IncidentCard({ incident, selected, onSelect }: IncidentCardProps) {
  const overdue = isOverdue(incident);
  const borderAccent = priorityBorderClass(incident.priority);
  const { session } = useSession();

  const isUnitOfficer = session?.role === "unit_officer";
  const myUnitId = session?.unit?.id;

  const assignedUnits = getAssignedUnits(incident);
  const isMyIncident = isUnitOfficer && myUnitId ? assignedUnits.includes(myUnitId) : false;
  const isAssignedToOther = isUnitOfficer && assignedUnits.length > 0 && !isMyIncident;
  const canTake = isUnitOfficer && canTakeIncident(session, incident);

  async function handleTake(e: React.MouseEvent) {
    e.stopPropagation(); // don't also trigger card select
    if (!myUnitId) return;
    try {
      await fetch(`${API_BASE}/dispatch/take`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: incident.id, unit_id: myUnitId, role: session?.role }),
      });
      // The SSE stream will update the incident in state
    } catch {
      // silently ignore; SSE will reflect result
    }
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Incident ${incident.cad_number ?? incident.id.slice(0, 8)}: ${incident.summary_line}`}
      className={[
        "animate-slide-up w-full rounded-lg border border-l-4 p-3 text-left transition",
        borderAccent,
        selected
          ? "border-blue-500/70 bg-blue-500/10"
          : overdue
            ? "border-slate-700/70 bg-red-950/20 hover:border-slate-500"
            : "border-slate-700/70 bg-command-card hover:border-slate-500",
      ].join(" ")}
    >
      {/* Row 1: ID + time */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono text-xs font-bold text-slate-200">
            {incident.cad_number ?? `#${incident.id.slice(0, 8).toUpperCase()}`}
          </p>
          {incident.type && (
            <span
              className={`rounded border px-1 py-0 text-[9px] font-bold uppercase tracking-wider ${
                TYPE_COLORS[incident.type] ?? TYPE_COLORS.other
              }`}
            >
              {TYPE_LABELS[incident.type] ?? incident.type.toUpperCase()}
            </span>
          )}
        </div>
        <TimeAgo isoTime={incident.created_at} />
      </div>

      {/* Row 2: badges */}
      <div className="mb-1.5 flex items-center gap-1.5 flex-wrap">
        <SeverityBadge severity={incident.severity} />
        <StatusBadge status={incident.status} />
        {overdue && (
          <span className="rounded border border-red-700/60 bg-red-900/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-300">
            Overdue
          </span>
        )}
        {incident.escalated === 1 && (
          <span className="rounded border border-amber-700/60 bg-amber-900/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
            Escalated
          </span>
        )}
        {incident.covert_distress && (
          <span className="rounded border border-violet-700/60 bg-violet-900/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-300">
            Covert
          </span>
        )}
        {/* Unit Officer role badges */}
        {isMyIncident && (
          <span className="rounded border border-emerald-700/60 bg-emerald-900/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
            My Incident
          </span>
        )}
      </div>

      {/* Row 3: summary */}
      <p className="line-clamp-1 text-sm font-medium text-slate-100">
        {incident.summary_line}
      </p>

      {/* Row 4: address */}
      <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
        {incident.location.address}
      </p>

      {/* Row 5: injury / hazard indicators if present */}
      {(incident.injuries.count > 0 ||
        incident.hazards.fire ||
        incident.hazards.weapon) && (
        <div className="mt-1.5 flex items-center gap-2">
          {incident.injuries.count > 0 && (
            <span className="text-[10px] text-red-400">
              {incident.injuries.count} injur{incident.injuries.count === 1 ? "y" : "ies"}
            </span>
          )}
          {incident.hazards.fire && (
            <span className="text-[10px] text-orange-400">Fire risk</span>
          )}
          {incident.hazards.weapon && (
            <span className="text-[10px] text-red-400">Weapon reported</span>
          )}
        </div>
      )}

      {/* Row 6: Unit Officer action row */}
      {isUnitOfficer && (
        <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {canTake && (
            <button
              type="button"
              onClick={(e) => void handleTake(e)}
              className="flex items-center gap-1 rounded border border-emerald-700/70 bg-emerald-900/40 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-900"
            >
              I'll Respond
            </button>
          )}
          {isMyIncident && (
            <span className="flex items-center gap-1 rounded border border-emerald-700/60 bg-emerald-950/40 px-2 py-1 text-[11px] font-semibold text-emerald-300">
              My Incident
            </span>
          )}
          {isAssignedToOther && (
            <span className="text-[11px] text-slate-500 italic">View only</span>
          )}
        </div>
      )}
    </button>
  );
}
