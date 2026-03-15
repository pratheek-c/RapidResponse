import type { DashboardIncident } from "@/types/dashboard";
import { SeverityBadge } from "@/components/common/SeverityBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { TimeAgo } from "@/components/common/TimeAgo";

type IncidentCardProps = {
  incident: DashboardIncident;
  selected: boolean;
  onSelect: () => void;
};

export function IncidentCard({ incident, selected, onSelect }: IncidentCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`animate-slide-up w-full rounded-lg border p-3 text-left transition ${
        selected
          ? "border-blue-500/70 bg-blue-500/10"
          : "border-slate-700/70 bg-command-card hover:border-slate-500"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-slate-200">#{incident.id.slice(0, 8)}</p>
        <TimeAgo isoTime={incident.created_at} />
      </div>

      <div className="mb-2 flex items-center gap-2">
        <SeverityBadge severity={incident.severity} />
        <StatusBadge status={incident.status} />
      </div>

      <p className="line-clamp-1 text-sm font-medium text-slate-100">{incident.summary_line}</p>
      <p className="mt-1 line-clamp-1 text-xs text-slate-400">{incident.location.address}</p>
    </button>
  );
}
