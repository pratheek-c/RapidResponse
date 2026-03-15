import { useMemo, useState } from "react";
import type { DashboardIncident } from "@/types/dashboard";
import { IncidentCard } from "@/components/incidents/IncidentCard";

type IncidentListProps = {
  incidents: DashboardIncident[];
  selectedId: string | null;
  onSelect: (incidentId: string) => void;
};

type Filter = "all" | "active" | "dispatched" | "completed";

export function IncidentList({ incidents, selectedId, onSelect }: IncidentListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter((incident) => {
      const byFilter =
        filter === "all"
          ? true
          : filter === "active"
            ? incident.status === "active" || incident.status === "classified"
            : filter === "dispatched"
              ? incident.status === "dispatched" || incident.status === "en_route" || incident.status === "on_scene"
              : incident.status === "completed" || incident.status === "resolved";

      if (!byFilter) return false;
      if (!q) return true;
      return (
        incident.id.toLowerCase().includes(q) ||
        incident.summary_line.toLowerCase().includes(q) ||
        incident.location.address.toLowerCase().includes(q)
      );
    });
  }, [filter, incidents, query]);

  return (
    <section className="flex h-full flex-col border-r border-slate-800 bg-command-panel">
      <div className="border-b border-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Incidents</p>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200">{filtered.length}</span>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search incidents"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none ring-blue-500 focus:ring-1"
        />
        <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
          {(["all", "active", "dispatched", "completed"] as Filter[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`rounded-md border px-1.5 py-1 capitalize ${
                filter === option
                  ? "border-blue-500/60 bg-blue-500/20 text-blue-100"
                  : "border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {filtered.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            selected={selectedId === incident.id}
            onSelect={() => onSelect(incident.id)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-700 p-4 text-center text-sm text-slate-400">
            No incidents match this filter.
          </p>
        )}
      </div>
    </section>
  );
}
