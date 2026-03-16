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
