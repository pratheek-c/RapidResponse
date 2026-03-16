import { useMemo, useState } from "react";
import { FileText, Zap, Radio } from "lucide-react";
import type { DashboardIncident } from "@/types/dashboard";
import { IncidentCard } from "@/components/incidents/IncidentCard";
import { categorizeIncidents } from "@/utils/incidentFilters";
import { useSession } from "@/context/SessionContext";

type UnitOfficerTab = "active" | "working" | "past";

type UnitOfficerIncidentListProps = {
  incidents: DashboardIncident[];
  selectedId: string | null;
  onSelect: (incidentId: string) => void;
};

export function UnitOfficerIncidentList({
  incidents,
  selectedId,
  onSelect,
}: UnitOfficerIncidentListProps) {
  const { session } = useSession();
  const myUnitId = session?.unit?.id ?? "";

  const [activeTab, setActiveTab] = useState<UnitOfficerTab>("active");
  const [query, setQuery] = useState("");

  const { active, working, past } = useMemo(
    () => categorizeIncidents(incidents, myUnitId),
    [incidents, myUnitId]
  );

  const tabList = useMemo<Array<{ id: UnitOfficerTab; label: string; icon: React.ReactNode; count: number }>>(
    () => [
      {
        id: "active",
        label: "Active",
        icon: <Radio className="h-3 w-3" />,
        count: active.length,
      },
      {
        id: "working",
        label: "Working",
        icon: <Zap className="h-3 w-3" />,
        count: working.length,
      },
      {
        id: "past",
        label: "Past",
        icon: <FileText className="h-3 w-3" />,
        count: past.length,
      },
    ],
    [active.length, working.length, past.length]
  );

  const currentList = useMemo(() => {
    const base = activeTab === "active" ? active : activeTab === "working" ? working : past;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (i) =>
        i.id.toLowerCase().includes(q) ||
        (i.cad_number ?? "").toLowerCase().includes(q) ||
        i.summary_line.toLowerCase().includes(q) ||
        i.location.address.toLowerCase().includes(q) ||
        (i.type ?? "").toLowerCase().includes(q)
    );
  }, [activeTab, active, working, past, query]);

  const hasWorking = working.length > 0;

  return (
    <section className="flex h-full flex-col border-r border-slate-800 bg-command-panel">
      {/* Header */}
      <div className="border-b border-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            My Incidents
          </p>
          <div className="flex items-center gap-1.5">
            {hasWorking && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            )}
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-200">
              {currentList.length}
            </span>
          </div>
        </div>

        {/* Search */}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by address, type, or ID…"
          aria-label="Search incidents"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none ring-blue-500 focus:ring-1"
        />

        {/* Tab strip */}
        <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
          {tabList.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-500/60 bg-blue-500/20 text-blue-100"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
              }`}
            >
              <span className="flex items-center gap-1">
                {tab.icon}
                {tab.label}
              </span>
              <span
                className={`text-[9px] font-bold tabular-nums ${
                  activeTab === tab.id ? "text-blue-300" : "text-slate-600"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab description */}
      {activeTab === "active" && (
        <p className="border-b border-slate-800/60 bg-slate-900/40 px-3 py-1.5 text-[10px] text-slate-500">
          All open incidents — use "I'll Respond" to self-assign
        </p>
      )}
      {activeTab === "working" && (
        <p className="border-b border-slate-800/60 bg-amber-950/20 px-3 py-1.5 text-[10px] text-amber-400/70">
          Your assigned incidents — select to open full detail
        </p>
      )}
      {activeTab === "past" && (
        <p className="border-b border-slate-800/60 bg-slate-900/40 px-3 py-1.5 text-[10px] text-slate-500">
          Your completed incidents — read-only
        </p>
      )}

      {/* List */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {currentList.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            selected={selectedId === incident.id}
            onSelect={() => onSelect(incident.id)}
          />
        ))}

        {currentList.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-700 p-4 text-center">
            {activeTab === "active" && (
              <p className="text-sm text-slate-400">No open incidents right now.</p>
            )}
            {activeTab === "working" && (
              <p className="text-sm text-slate-400">
                No active assignments.
                <br />
                <span className="text-xs text-slate-500">
                  Use "I'll Respond" from the Active tab to self-assign.
                </span>
              </p>
            )}
            {activeTab === "past" && (
              <p className="text-sm text-slate-400">No completed incidents yet.</p>
            )}
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300"
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
