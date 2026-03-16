import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useSSE } from "@/hooks/useSSE";
import { useSession } from "@/context/SessionContext";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type BackupAlert = {
  incident_id: string;
  requesting_unit: string;
  requested_types: string[];
  urgency: string;
  message: string;
};

const URGENCY_STYLES: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  emergency: {
    border: "border-red-700/60",
    bg: "bg-red-950/50",
    text: "text-red-200",
    dot: "bg-red-500 animate-pulse",
  },
  urgent: {
    border: "border-orange-700/60",
    bg: "bg-orange-950/40",
    text: "text-orange-200",
    dot: "bg-orange-400",
  },
  routine: {
    border: "border-yellow-700/60",
    bg: "bg-yellow-950/30",
    text: "text-yellow-200",
    dot: "bg-yellow-400",
  },
};

function getUrgencyStyle(urgency: string) {
  return URGENCY_STYLES[urgency.toLowerCase()] ?? URGENCY_STYLES.urgent;
}

export function BackupAlertBanner() {
  const { lastEvent } = useSSE();
  const { session } = useSession();
  const [alerts, setAlerts] = useState<BackupAlert[]>([]);
  const [respondingIds, setRespondingIds] = useState<Set<string>>(new Set());

  // Listen for backup_requested SSE events
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== "backup_requested") return;
    const data = lastEvent.data as BackupAlert;
    // Don't show alert to the unit that requested it
    if (session?.unit?.id === data.requesting_unit) return;
    setAlerts((prev) => {
      // De-duplicate by incident_id
      if (prev.some((a) => a.incident_id === data.incident_id)) return prev;
      return [...prev, data];
    });
  }, [lastEvent, session?.unit?.id]);

  if (alerts.length === 0) return null;

  function dismiss(incidentId: string) {
    setAlerts((prev) => prev.filter((a) => a.incident_id !== incidentId));
  }

  async function respond(alert: BackupAlert) {
    const myUnitId = session?.unit?.id;
    if (!myUnitId) return;
    setRespondingIds((prev) => new Set([...prev, alert.incident_id]));
    try {
      await fetch(`${API_BASE}/dispatch/backup-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: alert.incident_id,
          responding_unit: myUnitId,
        }),
      });
    } catch {
      // ignore — dismiss anyway
    } finally {
      dismiss(alert.incident_id);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {alerts.map((alert) => {
        const style = getUrgencyStyle(alert.urgency);
        const isResponding = respondingIds.has(alert.incident_id);
        const urgencyLabel = alert.urgency.toUpperCase();
        return (
          <div
            key={alert.incident_id}
            className={`flex items-start justify-between gap-3 border px-4 py-3 ${style.border} ${style.bg}`}
            role="alert"
            aria-live="assertive"
          >
            <div className="flex flex-1 items-start gap-3 min-w-0">
              {/* Urgency dot */}
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm font-bold ${style.text}`}>
                    BACKUP REQUEST from {alert.requesting_unit}
                  </p>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.border} ${style.text}`}
                  >
                    {urgencyLabel}
                  </span>
                </div>

                {alert.message && (
                  <p className="mt-0.5 text-xs text-slate-300 italic">
                    "{alert.message}"
                  </p>
                )}

                {alert.requested_types.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Needs: {alert.requested_types.join(", ")}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Only unit officers see the Respond button */}
              {session?.role === "unit_officer" && (
                <button
                  type="button"
                  onClick={() => void respond(alert)}
                  disabled={isResponding}
                  className="flex items-center gap-1 rounded border border-emerald-700/70 bg-emerald-900/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-900 disabled:opacity-50"
                >
                  {isResponding ? "Responding…" : "I'll Respond"}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(alert.incident_id)}
                aria-label="Dismiss backup alert"
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
