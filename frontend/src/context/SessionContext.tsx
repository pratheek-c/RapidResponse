import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { DashboardIncident } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserSession = {
  user: { id: string; name: string; email: string; avatar: string };
  role: "dispatcher" | "unit_officer";
  unit?: { id: string; type: string; label: string };
  station?: { id: string; name: string };
};

type SessionContextValue = {
  session: UserSession | null;
  setSession: (session: UserSession | null) => void;
  clearSession: () => void;
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const SESSION_KEY = "rr_user_session";

function loadFromStorage(): UserSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserSession;
  } catch {
    return null;
  }
}

function saveToStorage(session: UserSession | null): void {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<UserSession | null>(
    () => loadFromStorage()
  );

  const setSession = useCallback((next: UserSession | null) => {
    setSessionState(next);
    saveToStorage(next);
  }, []);

  const clearSession = useCallback(() => {
    setSessionState(null);
    saveToStorage(null);
  }, []);

  const value = useMemo(
    () => ({ session, setSession, clearSession }),
    [session, setSession, clearSession]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Returns the parsed assigned unit IDs array from the incident's
 * assigned_units string field (JSON array stored as text, or comma-separated).
 */
function getAssignedUnits(incident: DashboardIncident): string[] {
  if (!incident.assigned_units) return [];
  try {
    const parsed = JSON.parse(incident.assigned_units);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // fallback: treat as comma-separated
  }
  return incident.assigned_units
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Dispatcher can act on everything.
 * Unit Officer can act on incidents where their unit_id is in assigned_units.
 */
export function canActOnIncident(
  session: UserSession | null,
  incident: DashboardIncident
): boolean {
  if (!session) return false;
  if (session.role === "dispatcher") return true;
  if (!session.unit) return false;
  const assigned = getAssignedUnits(incident);
  return assigned.includes(session.unit.id);
}

/**
 * Unit Officer can take an unassigned incident (active/classified, no assigned units).
 * Dispatcher can always take.
 */
export function canTakeIncident(
  session: UserSession | null,
  incident: DashboardIncident
): boolean {
  if (!session) return false;
  if (session.role === "dispatcher") return true;
  const isOpenStatus =
    incident.status === "active" || incident.status === "classified";
  const unassigned = getAssignedUnits(incident).length === 0;
  return isOpenStatus && unassigned;
}

/**
 * Dispatcher can view everything.
 * Unit Officer can view full detail only for incidents assigned to them.
 */
export function canViewFullDetail(
  session: UserSession | null,
  incident: DashboardIncident
): boolean {
  if (!session) return false;
  if (session.role === "dispatcher") return true;
  if (!session.unit) return false;
  const assigned = getAssignedUnits(incident);
  return assigned.includes(session.unit.id);
}
