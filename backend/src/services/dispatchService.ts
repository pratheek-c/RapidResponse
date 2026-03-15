/**
 * Dispatch service.
 *
 * Handles unit dispatch logic:
 *  1. Find an available unit of the requested type
 *  2. Create a dispatch record in libSQL
 *  3. Update unit status to "dispatched"
 *  4. Update incident status to "dispatched"
 *  5. Broadcast SSE event to dispatcher dashboard
 *
 * Triggered by Nova Sonic `dispatch_unit` tool call.
 */

import { getDb } from "../db/libsql.ts";
import {
  dbListUnits,
  dbGetUnit,
  dbCreateDispatch,
  dbUpdateUnitStatus,
  dbUpdateIncident,
  dbCreateIncidentUnit,
  dbListIncidentUnits,
  dbCreateDispatchAction,
} from "../db/libsql.ts";
import { sseSend, pushSSE } from "./sseService.ts";
import type {
  Dispatch,
  Unit,
  UnitType,
  Department,
  AcceptRequest,
  EscalateRequest,
  IncidentUnit,
  IncidentStatus,
} from "../types/index.ts";

export type DispatchResult = {
  dispatch: Dispatch;
  unit: Unit;
};

// ---------------------------------------------------------------------------
// Dispatch a unit to an incident
// ---------------------------------------------------------------------------

/**
 * Find the first available unit of `unit_type`, create a dispatch record,
 * update both the unit and incident status, fire SSE event.
 *
 * Throws if no available unit of the requested type is found.
 */
export async function dispatchUnit(
  incident_id: string,
  unit_type: UnitType
): Promise<DispatchResult> {
  const db = getDb();

  // Find first available unit of the requested type
  const available = await dbListUnits(db, {
    status: "available",
    type: unit_type,
  });

  if (available.length === 0) {
    throw new Error(
      `No available ${unit_type} units for incident ${incident_id}`
    );
  }

  const unit = available[0];
  if (!unit) {
    throw new Error(`Unexpected: available unit array was non-empty but first element is undefined`);
  }

  try {
    // Create dispatch record
    const dispatch = await dbCreateDispatch(db, {
      incident_id,
      unit_id: unit.id,
    });

    // Update unit status
    await dbUpdateUnitStatus(db, unit.id, "dispatched", incident_id);

    // Update incident status
    await dbUpdateIncident(db, incident_id, { status: "dispatched" });

    // Notify dashboard
    sseSend("unit_dispatched", incident_id, {
      unit_id: unit.id,
      unit_code: unit.unit_code,
      unit_type,
      dispatch_id: dispatch.id,
      dispatched_at: dispatch.dispatched_at,
    });

    return { dispatch, unit: { ...unit, status: "dispatched", current_incident_id: incident_id } };
  } catch (err) {
    throw new Error(
      `Dispatch failed for incident ${incident_id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Mark unit as arrived on scene
// ---------------------------------------------------------------------------

export async function markUnitArrived(
  dispatch_id: string,
  unit_id: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.execute({
    sql: "UPDATE dispatches SET arrived_at = :arrived_at WHERE id = :id",
    args: { arrived_at: now, id: dispatch_id },
  });

  await dbUpdateUnitStatus(db, unit_id, "on_scene", null);
}

// ---------------------------------------------------------------------------
// Clear unit (return to available)
// ---------------------------------------------------------------------------

export async function clearUnit(
  dispatch_id: string,
  unit_id: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.execute({
    sql: "UPDATE dispatches SET cleared_at = :cleared_at WHERE id = :id",
    args: { cleared_at: now, id: dispatch_id },
  });

  await dbUpdateUnitStatus(db, unit_id, "available", null);
}

// ---------------------------------------------------------------------------
// Department ↔ UnitType mapping (API boundary translation)
// ---------------------------------------------------------------------------

/**
 * Maps the dashboard-facing Department label to the DB-level UnitType.
 *   patrol  → police
 *   medical → ems
 *   fire    → fire
 *   hazmat  → hazmat
 */
export function departmentToUnitType(dept: Department): UnitType {
  switch (dept) {
    case "patrol":  return "police";
    case "medical": return "ems";
    case "fire":    return "fire";
    case "hazmat":  return "hazmat";
  }
}

/**
 * Build a human-readable dispatch message to inject into Nova Sonic
 * when a dispatcher manually accepts or escalates an incident.
 */
export function buildDispatchMessage(unitTypes: Department[]): string {
  if (unitTypes.length === 0) return "A dispatcher has reviewed your call and is coordinating a response.";
  const labels: Record<Department, string> = {
    patrol:  "police patrol",
    medical: "medical / EMS",
    fire:    "fire department",
    hazmat:  "hazmat response",
  };
  const names = unitTypes.map((d) => labels[d]);
  const joined =
    names.length === 1
      ? names[0]!
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return `A dispatcher has reviewed your call and is sending ${joined} to your location. Please stay on the line.`;
}

// ---------------------------------------------------------------------------
// Accept an incident — dispatcher takes ownership and assigns units
// ---------------------------------------------------------------------------

export type AcceptResult = {
  incident_id: string;
  officer_id: string;
  units: IncidentUnit[];
  status: IncidentStatus;
};

/**
 * Accept an incident on behalf of an officer.
 *  1. Records a dispatch_action of type "accept"
 *  2. For each unit_id supplied, creates an incident_unit row and marks the
 *     unit as dispatched in the units table
 *  3. Stamps accepted_at, officer_id, and status on the incident
 *  4. Pushes a status_change SSE event
 */
export async function acceptIncident(req: AcceptRequest): Promise<AcceptResult> {
  const db = getDb();
  const now = new Date().toISOString();

  // 1. Log the dispatch action
  await dbCreateDispatchAction(db, {
    incident_id: req.incident_id,
    action_type: "accept",
    officer_id: req.officer_id,
    payload: { unit_ids: req.unit_ids },
  });

  // 2. Create incident_unit rows + update unit statuses
  const units: IncidentUnit[] = [];
  for (const unit_id of req.unit_ids) {
    const unit = await dbGetUnit(db, unit_id);
    if (!unit) continue;

    const incidentUnit = await dbCreateIncidentUnit(db, {
      incident_id: req.incident_id,
      unit_id,
      unit_type: unit.type,
    });
    units.push(incidentUnit);

    await dbUpdateUnitStatus(db, unit_id, "dispatched", req.incident_id);
  }

  // Build the assigned_units JSON array from existing + new
  const existing = await dbListIncidentUnits(db, req.incident_id);
  const allUnitIds = [...new Set(existing.map((u) => u.unit_id).concat(req.unit_ids))];

  // 3. Update incident record
  const updatedIncident = await dbUpdateIncident(db, req.incident_id, {
    status: "dispatched",
    accepted_at: now,
    officer_id: req.officer_id,
    assigned_units: JSON.stringify(allUnitIds),
  });

  const status: IncidentStatus = updatedIncident?.status ?? "dispatched";

  // 4. Push SSE
  pushSSE({
    type: "status_change",
    data: { incident_id: req.incident_id, status },
  });

  return { incident_id: req.incident_id, officer_id: req.officer_id, units, status };
}

// ---------------------------------------------------------------------------
// Escalate an incident — request additional units
// ---------------------------------------------------------------------------

export type EscalateResult = {
  incident_id: string;
  requested_unit_types: Department[];
  status: IncidentStatus;
};

/**
 * Escalate an incident by requesting additional unit types.
 *  1. Records a dispatch_action of type "escalate"
 *  2. Marks the incident as escalated and updates status to "en_route"
 *  3. Pushes a status_change SSE event
 */
export async function escalateIncident(req: EscalateRequest): Promise<EscalateResult> {
  const db = getDb();

  // 1. Log the dispatch action
  await dbCreateDispatchAction(db, {
    incident_id: req.incident_id,
    action_type: "escalate",
    payload: { reason: req.reason, requested_unit_types: req.requested_unit_types },
  });

  // 2. Update incident
  const updatedIncident = await dbUpdateIncident(db, req.incident_id, {
    status: "en_route",
    escalated: 1,
  });

  const status: IncidentStatus = updatedIncident?.status ?? "en_route";

  // 3. Push SSE
  pushSSE({
    type: "status_change",
    data: { incident_id: req.incident_id, status },
  });

  return { incident_id: req.incident_id, requested_unit_types: req.requested_unit_types, status };
}
