import type { IncidentStatus } from "@/types/dashboard";

type StatusBadgeProps = {
  status: IncidentStatus;
};

const statusStyle: Record<IncidentStatus, string> = {
  active:     "bg-amber-500/20 text-amber-200 ring-amber-500/50",   // amber — needs attention
  classified: "bg-blue-500/20 text-blue-200 ring-blue-500/50",      // blue — being assessed
  dispatched: "bg-violet-500/20 text-violet-200 ring-violet-500/50", // indigo/purple — units assigned
  en_route:   "bg-cyan-500/20 text-cyan-200 ring-cyan-500/50",      // cyan — units moving
  on_scene:   "bg-emerald-500/20 text-emerald-200 ring-emerald-500/50", // green — units arrived
  completed:  "bg-slate-500/15 text-slate-300 ring-slate-500/40",   // slate — closed
  resolved:   "bg-slate-500/15 text-slate-300 ring-slate-500/40",   // slate — closed
  cancelled:  "bg-red-900/40 text-red-300 ring-red-800/60",         // dark red — cancelled
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const dotClass = status === "active" ? "animate-pulse-soft" : "";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${dotClass}`} />
      {status.replace("_", " ")}
    </span>
  );
}
