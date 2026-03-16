import type { DashboardIncident } from "@/types/dashboard";

export type Filter = "all" | "active" | "dispatched" | "completed";

export function filterIncidentsByTab(
  incidents: DashboardIncident[],
  filter: Filter
): DashboardIncident[] {
  if (filter === "all") return incidents;
  if (filter === "active")
    return incidents.filter(
      (i) => i.status === "active" || i.status === "classified"
    );
  if (filter === "dispatched")
    return incidents.filter(
      (i) =>
        i.status === "dispatched" ||
        i.status === "en_route" ||
        i.status === "on_scene"
    );
  // completed
  return incidents.filter(
    (i) => i.status === "completed" || i.status === "resolved"
  );
}

// ---------------------------------------------------------------------------
// Unit officer tab categorisation
// ---------------------------------------------------------------------------

function parseAssignedUnits(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const PRIORITY_ORDER: Record<string, number> = { P1: 4, P2: 3, P3: 2, P4: 1 };

function priorityRank(incident: DashboardIncident): number {
  return PRIORITY_ORDER[incident.priority ?? ""] ?? 0;
}

export type CategorisedIncidents = {
  /** All incidents NOT assigned to this officer — sorted: unassigned first, then by priority desc */
  active: DashboardIncident[];
  /** Incidents currently assigned to this officer (not completed/resolved) — sorted priority desc */
  working: DashboardIncident[];
  /** Incidents completed/resolved that were assigned to this officer — sorted completed_at desc */
  past: DashboardIncident[];
};

export function categorizeIncidents(
  incidents: DashboardIncident[],
  myUnitId: string
): CategorisedIncidents {
  const active: DashboardIncident[] = [];
  const working: DashboardIncident[] = [];
  const past: DashboardIncident[] = [];

  for (const inc of incidents) {
    const assignedUnits = parseAssignedUnits(inc.assigned_units);
    const isMine = assignedUnits.includes(myUnitId);
    const isDone = inc.status === "completed" || inc.status === "resolved";

    if (isMine && isDone) {
      past.push(inc);
    } else if (isMine) {
      working.push(inc);
    } else {
      active.push(inc);
    }
  }

  // Active: unassigned incidents first, then assigned-to-others; within each group priority desc
  active.sort((a, b) => {
    const aUnassigned = parseAssignedUnits(a.assigned_units).length === 0 ? 1 : 0;
    const bUnassigned = parseAssignedUnits(b.assigned_units).length === 0 ? 1 : 0;
    if (bUnassigned !== aUnassigned) return bUnassigned - aUnassigned;
    return priorityRank(b) - priorityRank(a);
  });

  // Working: priority desc
  working.sort((a, b) => priorityRank(b) - priorityRank(a));

  // Past: completed_at desc (fall back to updated_at)
  past.sort((a, b) => {
    const ta = Date.parse(a.completed_at ?? a.updated_at);
    const tb = Date.parse(b.completed_at ?? b.updated_at);
    return tb - ta;
  });

  return { active, working, past };
}

