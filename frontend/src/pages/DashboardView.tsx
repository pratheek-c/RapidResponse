import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Header } from "@/components/common/Header";
import { MapLegend } from "@/components/map/MapLegend";
import { CommandMap } from "@/components/map/CommandMap";
import { IncidentList } from "@/components/incidents/IncidentList";
import { IncidentDetail } from "@/components/incidents/IncidentDetail";
import { useAuth } from "@/hooks/useAuth";
import { useIncidents } from "@/hooks/useIncidents";
import { useUnits } from "@/hooks/useUnits";
import type { DashboardIncident } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Stats bar tile
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[90px] flex-col items-center justify-center gap-0.5 border-r border-slate-800 px-5 py-2 ${
        highlight ? "bg-slate-800/60" : ""
      }`}
    >
      <span
        className={`font-mono text-xl font-black tabular-nums leading-none ${
          highlight ? "text-slate-100" : "text-slate-200"
        }`}
      >
        {value}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </span>
      {sub && <span className="text-[9px] text-slate-600">{sub}</span>}
    </div>
  );
}

function StatsBar({
  incidents,
  units,
  connected,
}: {
  incidents: DashboardIncident[];
  units: { status: string }[];
  connected: boolean;
}) {
  const active = incidents.filter(
    (i) => i.status === "active" || i.status === "classified"
  ).length;
  const dispatched = incidents.filter(
    (i) => i.status === "dispatched" || i.status === "en_route" || i.status === "on_scene"
  ).length;
  const resolved = incidents.filter(
    (i) => i.status === "resolved" || i.status === "completed"
  ).length;
  const p1 = incidents.filter((i) => i.priority === "P1").length;
  const availUnits = units.filter((u) => u.status === "available").length;
  const totalUnits = units.length;

  // Utilisation % — units that are not available
  const utilPct =
    totalUnits > 0 ? Math.round(((totalUnits - availUnits) / totalUnits) * 100) : 0;

  return (
    <div className="flex items-stretch border-b border-slate-800 bg-command-panel text-command-text">
      <StatTile label="Active" value={active} highlight={active > 0} />
      <StatTile label="Dispatched" value={dispatched} />
      <StatTile label="Resolved" value={resolved} sub="this shift" />
      <StatTile label="P1 Critical" value={p1} highlight={p1 > 0} />
      <StatTile label="Units Avail" value={`${availUnits}/${totalUnits}`} />
      <StatTile label="Utilisation" value={`${utilPct}%`} />

      {/* Spacer / status text */}
      <div className="flex flex-1 items-center justify-end gap-4 px-4">
        <span className="hidden text-[10px] font-medium text-slate-500 lg:inline">
          Dublin Emergency Communications Centre · DECC-01
        </span>
        <span
          className={`text-[10px] font-bold ${
            connected ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {connected ? "● SYSTEM LIVE" : "● SYSTEM OFFLINE"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state for when no incident is selected
// ---------------------------------------------------------------------------

function NoSelectionPanel({
  incidents,
}: {
  incidents: DashboardIncident[];
}) {
  const active = incidents.filter(
    (i) => i.status === "active" || i.status === "classified"
  ).length;
  const p1 = incidents.filter((i) => i.priority === "P1").length;
  const dispatched = incidents.filter(
    (i) =>
      i.status === "dispatched" ||
      i.status === "en_route" ||
      i.status === "on_scene"
  ).length;

  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-xs">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
          Dublin Emergency Communications Centre
        </p>
        <div className="mt-4 flex justify-center gap-6">
          {[
            { label: "Active", value: active, urgent: active > 0 },
            { label: "P1 Critical", value: p1, urgent: p1 > 0 },
            { label: "Dispatched", value: dispatched, urgent: false },
          ].map(({ label, value, urgent }) => (
            <div key={label} className="text-center">
              <p
                className={`font-mono text-3xl font-black tabular-nums ${
                  urgent && value > 0 ? "text-red-400" : "text-slate-600"
                }`}
              >
                {value}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                {label}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-slate-500">
          Select an incident from the map or sidebar to open dispatch controls.
        </p>
        <p className="mt-1 text-[10px] text-slate-600">
          Keyboard: F4 Accept · F6 Escalate · F8 Complete
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard view
// ---------------------------------------------------------------------------

export function DashboardView() {
  const { user, loading, isAuthenticated, department, signOut } = useAuth();
  const { incidents, connected } = useIncidents();
  const { units } = useUnits();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedId) ?? null,
    [incidents, selectedId]
  );

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-command-bg text-slate-300">
        <div className="flex flex-col items-center gap-3">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
          <span className="text-sm text-slate-400">Connecting to DECC…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !department) {
    return <Navigate to="/login" replace />;
  }

  const userLabel = user?.displayName ?? user?.email ?? "Dispatcher";
  const officerId = user?.uid ?? "dispatcher-local";

  return (
    <main className="flex min-h-screen flex-col bg-command-bg text-command-text">
      <Header
        connected={connected}
        department={department}
        userLabel={userLabel}
        onSignOut={signOut}
      />

      <StatsBar incidents={incidents} units={units} connected={connected} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: incident list */}
        <div className="hidden w-[300px] shrink-0 lg:block">
          <IncidentList
            incidents={incidents}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Centre: map */}
        <section className="flex flex-1 flex-col gap-3 p-3">
          <div className="flex-1">
            <CommandMap
              incidents={incidents}
              units={units}
              selectedIncidentId={selectedId}
              onSelectIncident={setSelectedId}
            />
          </div>
        </section>

        {/* Right: incident detail / dispatch controls */}
        <aside className="w-full shrink-0 border-l border-slate-800 bg-command-panel md:w-[420px]">
          {selectedIncident ? (
            <IncidentDetail
              incident={selectedIncident}
              units={units}
              officerId={officerId}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <NoSelectionPanel incidents={incidents} />
          )}
        </aside>
      </div>

      <MapLegend />
    </main>
  );
}
