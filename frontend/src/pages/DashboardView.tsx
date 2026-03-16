import { useMemo, useState, useRef, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Header } from "@/components/common/Header";
import { MapLegend } from "@/components/map/MapLegend";
import { CommandMap } from "@/components/map/CommandMap";
import { IncidentList } from "@/components/incidents/IncidentList";
import { IncidentDetail } from "@/components/incidents/IncidentDetail";
import { BackupAlertBanner } from "@/components/common/BackupAlertBanner";
import { AssignmentAlertBanner } from "@/components/common/AssignmentAlertBanner";
import { useAuth } from "@/hooks/useAuth";
import { useIncidents } from "@/hooks/useIncidents";
import { useUnits } from "@/hooks/useUnits";
import { useDispatcherLocation } from "@/hooks/useDispatcherLocation";
import { useSession } from "@/context/SessionContext";
import { filterIncidentsByTab, type Filter } from "@/utils/incidentFilters";
import type { DashboardIncident } from "@/types/dashboard";
import { DEFAULT_MAP_CENTER } from "@/config/constants";
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

// ---------------------------------------------------------------------------
// Distance calculation and Active Incident Ticker
// ---------------------------------------------------------------------------

function getDistanceKM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p = 0.017453292519943295; // Math.PI / 180
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p)/2 +
            c(lat1 * p) * c(lat2 * p) *
            (1 - c((lon2 - lon1) * p))/2;
  return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
}

function IncidentTicker({
  incidents,
  onSelect,
}: {
  incidents: DashboardIncident[];
  onSelect: (id: string) => void;
}) {
  const activeNearby = useMemo(() => {
    return incidents.filter(i => {
      if (i.status === "completed" || i.status === "resolved" || i.status === "cancelled") return false;
      const dist = getDistanceKM(DEFAULT_MAP_CENTER[0], DEFAULT_MAP_CENTER[1], i.location.lat, i.location.lng);
      return dist <= 10;
    });
  }, [incidents]);

  if (activeNearby.length === 0) return null;

  // Duplicate items for seamless continuous scrolling
  const tickerItems = [...activeNearby, ...activeNearby, ...activeNearby, ...activeNearby];

  return (
    <div className="flex w-full items-center overflow-hidden border-b border-slate-800 bg-slate-950 px-2 py-1.5 text-xs">
      <div className="mr-3 flex shrink-0 items-center gap-1.5 rounded bg-red-950/50 px-2 py-0.5 font-bold uppercase tracking-widest text-red-400">
        <AlertTriangle className="h-3 w-3 animate-pulse" />
        Live Feed (10km)
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex shrink-0 animate-ticker items-center gap-6 whitespace-nowrap">
          {tickerItems.map((inc, i) => (
            <button
              key={`${inc.id}-${i}`}
              onClick={() => onSelect(inc.id)}
              className="flex items-center gap-2 transition-colors hover:text-blue-300"
            >
              <span className={`font-mono font-bold ${inc.priority === 'P1' ? 'text-red-400' : 'text-slate-300'}`}>
                {inc.cad_number || inc.id.split('-').pop()?.toUpperCase()}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-200 capitalize">{inc.type || 'unknown'} — {inc.caller_address || inc.caller_location}</span>
              <span className="text-slate-500">
                ({getDistanceKM(DEFAULT_MAP_CENTER[0], DEFAULT_MAP_CENTER[1], inc.location.lat, inc.location.lng).toFixed(1)}km)
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function playP1Tone() {
  try {
    const ctx = new AudioContext();
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.18, ctx.currentTime);
    gainNode.connect(ctx.destination);

    function playTone(freq: number, start: number, duration: number) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      osc.connect(gainNode);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    }

    playTone(880, 0, 0.3);
    playTone(660, 0.35, 0.3);

    // Close context after tones finish
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // AudioContext unavailable — silently ignore
  }
}

export function DashboardView() {
  const { user, loading, isAuthenticated, department, signOut } = useAuth();
  const { session } = useSession();
  const { incidents, connected } = useIncidents();
  const { units } = useUnits();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // Feature 2: shared filter state lifted from IncidentList
  const [mapFilter, setMapFilter] = useState<Filter>("all");
  const mapIncidents = useMemo(
    () => filterIncidentsByTab(incidents, mapFilter),
    [incidents, mapFilter]
  );

  // Feature 1: dispatcher live location + OSRM route info
  const dispatcherLocation = useDispatcherLocation();
  const [routeInfo, setRouteInfo] = useState<{
    distanceMeters: number;
    durationSeconds: number;
  } | null>(null);

  // Detect genuinely new P1 incidents and fire alert tone
  useEffect(() => {
    for (const incident of incidents) {
      if (incident.priority === "P1" && !seenIds.current.has(incident.id)) {
        seenIds.current.add(incident.id);
        if (
          incident.status !== "completed" &&
          incident.status !== "resolved" &&
          incident.status !== "cancelled"
        ) {
          playP1Tone();
        }
      } else {
        seenIds.current.add(incident.id);
      }
    }
  }, [incidents]);

  // Clear route info when incident selection changes
  useEffect(() => {
    setRouteInfo(null);
  }, [selectedId]);

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

  if (!isAuthenticated || !session) {
    return <Navigate to="/login" replace />;
  }

  const userLabel = user?.displayName ?? user?.email ?? "Dispatcher";
  const officerId = user?.uid ?? "dispatcher-local";

  return (
    <main className="flex h-screen flex-col bg-command-bg text-command-text">
      <Header
        connected={connected}
        department={department}
        userLabel={userLabel}
        onSignOut={signOut}
      />

      {/* Assignment alert banner — shown to targeted unit officers */}
      <AssignmentAlertBanner onSelectIncident={setSelectedId} />

      {/* Backup alert banner — shown when a backup_requested SSE event arrives */}
      <BackupAlertBanner />

      {/* Horizontal scrolling ticker for nearby active incidents */}
      <IncidentTicker incidents={incidents} onSelect={setSelectedId} />

      <StatsBar incidents={incidents} units={units} connected={connected} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: incident list — filter state is lifted so the map stays in sync */}
        <div className="hidden w-[300px] shrink-0 overflow-y-auto lg:block">
          <IncidentList
            incidents={incidents}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filter={mapFilter}
            onFilterChange={setMapFilter}
          />
        </div>

        {/* Centre: map */}
        <section className="flex min-h-0 flex-1 flex-col p-3">
          <div className="relative min-h-0 flex-1">
            {/* ETA pill — shown when a route has been calculated */}
            {routeInfo !== null && (
              <div className="absolute left-2 top-2 z-[1000] rounded border border-cyan-800 bg-black/80 px-2 py-1 font-mono text-xs text-cyan-400">
                ● Route: {(routeInfo.distanceMeters / 1000).toFixed(1)} km · ~{Math.ceil(routeInfo.durationSeconds / 60)} min drive
              </div>
            )}
            <CommandMap
              incidents={mapIncidents}
              units={units}
              selectedIncidentId={selectedId}
              onSelectIncident={setSelectedId}
              dispatcherLocation={dispatcherLocation}
              onRouteInfo={setRouteInfo}
              ownUnitId={session?.unit?.id}
            />
          </div>
        </section>

        {/* Right: incident detail / dispatch controls */}
        <aside className="w-full shrink-0 overflow-y-auto border-l border-slate-800 bg-command-panel md:w-[420px]">
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
