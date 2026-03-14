/**
 * Incident service.
 *
 * High-level business logic for creating and managing incidents.
 * Wraps libSQL helpers and fires SSE events to the dashboard.
 *
 * All database errors are caught and re-thrown with context —
 * never crash the WebSocket handler.
 */

import { getDb } from "../db/libsql.ts";
import {
  dbCreateIncident,
  dbGetIncident,
  dbListIncidents,
  dbUpdateIncident,
} from "../db/libsql.ts";
import { sseSend } from "./sseService.ts";
import type {
  Incident,
  CreateIncidentInput,
  UpdateIncidentInput,
  IncidentType,
  IncidentPriority,
} from "../types/index.ts";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createIncident(
  input: CreateIncidentInput
): Promise<Incident> {
  const db = getDb();
  try {
    const incident = await dbCreateIncident(db, input);
    sseSend("incident_created", incident.id, incident);
    return incident;
  } catch (err) {
    throw new Error(
      `Failed to create incident: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getIncident(id: string): Promise<Incident | null> {
  const db = getDb();
  try {
    return await dbGetIncident(db, id);
  } catch (err) {
    throw new Error(
      `Failed to get incident ${id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function listIncidents(opts: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<Incident[]> {
  const db = getDb();
  try {
    return await dbListIncidents(db, opts);
  } catch (err) {
    throw new Error(
      `Failed to list incidents: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateIncident(
  id: string,
  input: UpdateIncidentInput
): Promise<Incident | null> {
  const db = getDb();
  try {
    const updated = await dbUpdateIncident(db, id, input);
    if (updated) {
      sseSend("incident_updated", id, updated);
    }
    return updated;
  } catch (err) {
    throw new Error(
      `Failed to update incident ${id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Classify (triggered by Nova Sonic tool call)
// ---------------------------------------------------------------------------

export async function classifyIncident(
  incident_id: string,
  type: IncidentType,
  priority: IncidentPriority
): Promise<Incident | null> {
  const db = getDb();
  try {
    const updated = await dbUpdateIncident(db, incident_id, {
      type,
      priority,
      status: "active", // still active until dispatch
    });

    if (updated) {
      sseSend("incident_classified", incident_id, { type, priority, incident: updated });
    }

    return updated;
  } catch (err) {
    throw new Error(
      `Failed to classify incident ${incident_id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Resolve / close
// ---------------------------------------------------------------------------

export async function resolveIncident(
  incident_id: string,
  summary: string
): Promise<Incident | null> {
  const db = getDb();
  try {
    const updated = await dbUpdateIncident(db, incident_id, {
      status: "resolved",
      summary,
      resolved_at: new Date().toISOString(),
    });

    if (updated) {
      sseSend("call_ended", incident_id, updated);
    }

    return updated;
  } catch (err) {
    throw new Error(
      `Failed to resolve incident ${incident_id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
