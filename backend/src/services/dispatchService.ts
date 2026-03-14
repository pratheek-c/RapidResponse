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
  dbCreateDispatch,
  dbUpdateUnitStatus,
  dbUpdateIncident,
} from "../db/libsql.ts";
import { sseSend } from "./sseService.ts";
import type { Dispatch, Unit, UnitType } from "../types/index.ts";

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
