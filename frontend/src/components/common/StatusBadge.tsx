import type { IncidentStatus } from "@/types/dashboard";

type StatusBadgeProps = {
  status: IncidentStatus;
};

const statusStyle: Record<IncidentStatus, string> = {
  active: "bg-red-500/15 text-red-300 ring-red-500/40",
  classified: "bg-blue-500/15 text-blue-300 ring-blue-500/40",
  dispatched: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  en_route: "bg-blue-500/15 text-blue-300 ring-blue-500/40",
  on_scene: "bg-violet-500/15 text-violet-300 ring-violet-500/40",
  completed: "bg-slate-500/15 text-slate-300 ring-slate-500/40",
  resolved: "bg-slate-500/15 text-slate-300 ring-slate-500/40",
  cancelled: "bg-slate-700/30 text-slate-400 ring-slate-700/40",
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
