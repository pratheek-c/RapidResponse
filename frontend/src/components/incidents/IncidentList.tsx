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
  const [filter, setFilter] = useState<Filter>("active");

  const counts = useMemo<Record<Filter, number>>(
    () => ({
      all: incidents.length,
      active: incidents.filter(
        (i) => i.status === "active" || i.status === "classified"
      ).length,
      dispatched: incidents.filter(
        (i) =>
          i.status === "dispatched" ||
          i.status === "en_route" ||
          i.status === "on_scene"
      ).length,
      completed: incidents.filter(
        (i) => i.status === "completed" || i.status === "resolved"
      ).length,
    }),
    [incidents]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter((incident) => {
      const byFilter =
        filter === "all"
          ? true
          : filter === "active"
            ? incident.status === "active" || incident.status === "classified"
            : filter === "dispatched"
              ? incident.status === "dispatched" ||
                incident.status === "en_route" ||
                incident.status === "on_scene"
              : incident.status === "completed" || incident.status === "resolved";

      if (!byFilter) return false;
      if (!q) return true;
      return (
        incident.id.toLowerCase().includes(q) ||
        incident.summary_line.toLowerCase().includes(q) ||
        incident.location.address.toLowerCase().includes(q) ||
        (incident.type ?? "").toLowerCase().includes(q)
      );
    });
  }, [filter, incidents, query]);

  const hasActive = counts.active > 0;

  return (
    <section className="flex h-full flex-col border-r border-slate-800 bg-command-panel">
      <div className="border-b border-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Incidents
          </p>
          <div className="flex items-center gap-1.5">
            {hasActive && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            )}
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-200">
              {filtered.length}
            </span>
          </div>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by address, type, or ID…"
          aria-label="Search incidents"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none ring-blue-500 focus:ring-1"
        />

        <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
          {(["all", "active", "dispatched", "completed"] as Filter[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`flex flex-col items-center rounded-md border px-1 py-1 capitalize transition-colors ${
                filter === option
                  ? "border-blue-500/60 bg-blue-500/20 text-blue-100"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
              }`}
            >
              <span>{option}</span>
              <span
                className={`text-[9px] font-bold tabular-nums ${
                  filter === option ? "text-blue-300" : "text-slate-600"
                }`}
              >
                {counts[option]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {filtered.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            selected={selectedId === incident.id}
            onSelect={() => onSelect(incident.id)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-700 p-4 text-center">
            <p className="text-sm text-slate-400">No incidents match this filter.</p>
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-1 text-xs text-blue-400 hover:text-blue-300"
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
