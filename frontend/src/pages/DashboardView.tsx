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
    return <div className="grid min-h-screen place-items-center bg-command-bg text-slate-300">Loading...</div>;
  }

  if (!isAuthenticated || !department) {
    return <Navigate to="/login" replace />;
  }

  const userLabel = user?.displayName ?? user?.email ?? "Dispatcher";
  const officerId = user?.uid ?? "dispatcher-local";

  return (
    <main className="flex min-h-screen flex-col bg-command-bg text-command-text">
      <Header connected={connected} department={department} userLabel={userLabel} onSignOut={signOut} />

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden w-[320px] lg:block">
          <IncidentList incidents={incidents} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

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

        <aside className="w-full border-l border-slate-800 bg-command-panel md:w-[420px]">
          {selectedIncident ? (
            <IncidentDetail incident={selectedIncident} units={units} officerId={officerId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-slate-400">
              Select an incident from the map or list to open dispatch controls.
            </div>
          )}
        </aside>
      </div>

      <MapLegend />
    </main>
  );
}
