import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useSSE } from "@/hooks/useSSE";
import { useSession } from "@/context/SessionContext";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type SuggestionAlert = {
  kind: "suggested";
  incident_id: string;
  unit_type: string;
  distance_km: number;
  priority: string;
};

type AutoDispatchAlert = {
  kind: "auto";
  incident_id: string;
  unit_type: string;
};

type AssignmentAlert = SuggestionAlert | AutoDispatchAlert;

export function AssignmentAlertBanner({
  onSelectIncident,
}: {
  onSelectIncident?: (incidentId: string) => void;
}) {
  const { lastEvent } = useSSE();
  const { session } = useSession();
  const [alerts, setAlerts] = useState<AssignmentAlert[]>([]);
  const [acceptingIds, setAcceptingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === "assignment_suggested") {
      const data = lastEvent.data as {
        incident_id: string;
        suggested_unit: string;
        unit_type: string;
        distance_km: number;
        priority: string;
      };
      // Only show to the targeted unit
      if (session?.unit?.id !== data.suggested_unit) return;
      setAlerts((prev) => {
        if (prev.some((a) => a.incident_id === data.incident_id)) return prev;
        const alert: SuggestionAlert = {
          kind: "suggested",
          incident_id: data.incident_id,
          unit_type: data.unit_type,
          distance_km: data.distance_km,
          priority: data.priority,
        };
        return [...prev, alert];
      });
    }

    if (lastEvent.type === "unit_auto_dispatched") {
      const data = lastEvent.data as {
        incident_id: string;
        unit_id: string;
        unit_type: string;
        auto: true;
      };
      // Only show to the unit that was auto-dispatched
      if (session?.unit?.id !== data.unit_id) return;
      setAlerts((prev) => {
        if (prev.some((a) => a.incident_id === data.incident_id)) return prev;
        const alert: AutoDispatchAlert = {
          kind: "auto",
          incident_id: data.incident_id,
          unit_type: data.unit_type,
        };
        return [...prev, alert];
      });
    }
  }, [lastEvent, session?.unit?.id]);

  if (alerts.length === 0) return null;

  function dismiss(incidentId: string) {
    setAlerts((prev) => prev.filter((a) => a.incident_id !== incidentId));
  }

  async function acceptAssignment(alert: SuggestionAlert) {
    const myUnitId = session?.unit?.id;
    if (!myUnitId) return;
    setAcceptingIds((prev) => new Set([...prev, alert.incident_id]));
    try {
      await fetch(`${API_BASE}/dispatch/take`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: alert.incident_id,
          unit_id: myUnitId,
          role: "unit_officer",
        }),
      });
    } catch {
      // non-fatal
    } finally {
      dismiss(alert.incident_id);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {alerts.map((alert) => {
        const isAccepting = acceptingIds.has(alert.incident_id);

        if (alert.kind === "auto") {
          return (
            <div
              key={alert.incident_id}
              className="flex items-start justify-between gap-3 border border-red-700/60 bg-red-950/50 px-4 py-3"
              role="alert"
              aria-live="assertive"
            >
              <div className="flex flex-1 items-start gap-3 min-w-0">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-red-200">
                      EMERGENCY AUTO-DISPATCH
                    </p>
                    <span className="rounded border border-red-700/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-200">
                      {alert.unit_type.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-300">
                    You have been automatically dispatched to incident{" "}
                    <span className="font-mono font-semibold text-red-300">
                      {alert.incident_id.split("-").pop()?.toUpperCase()}
                    </span>
                    . Respond immediately.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {onSelectIncident && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectIncident(alert.incident_id);
                      dismiss(alert.incident_id);
                    }}
                    className="flex items-center gap-1 rounded border border-red-700/70 bg-red-900/40 px-2.5 py-1 text-xs font-semibold text-red-200 transition-colors hover:bg-red-900"
                  >
                    View Incident
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(alert.incident_id)}
                  aria-label="Dismiss auto-dispatch alert"
                  className="rounded border border-slate-700 p-1 text-slate-400 transition-colors hover:bg-slate-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        }

        // Suggestion alert
        return (
          <div
            key={alert.incident_id}
            className="flex items-start justify-between gap-3 border border-amber-700/60 bg-amber-950/40 px-4 py-3"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex flex-1 items-start gap-3 min-w-0">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-orange-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-amber-200">
                    ASSIGNMENT ALERT
                  </p>
                  <span className="rounded border border-amber-700/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                    {alert.priority}
                  </span>
                  <span className="rounded border border-amber-700/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    {alert.unit_type.toUpperCase()}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-300">
                  You are being suggested for incident{" "}
                  <span className="font-mono font-semibold text-amber-300">
                    {alert.incident_id.split("-").pop()?.toUpperCase()}
                  </span>
                  . Accept to take ownership.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void acceptAssignment(alert)}
                disabled={isAccepting}
                className="flex items-center gap-1 rounded border border-emerald-700/70 bg-emerald-900/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900 disabled:opacity-50"
              >
                {isAccepting ? "Accepting…" : "Accept Assignment"}
              </button>
              <button
                type="button"
                onClick={() => dismiss(alert.incident_id)}
                aria-label="Decline assignment"
                className="rounded border border-slate-700 p-1 text-slate-400 transition-colors hover:bg-slate-800"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
