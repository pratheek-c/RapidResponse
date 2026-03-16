/**
 * Dispatch REST routes.
 *
 * POST  /dispatch                       Manually dispatch a unit (admin override)
 * GET   /dispatch/:incident_id          Get dispatches for an incident
 * PATCH /dispatch/:dispatch_id/arrive   Mark unit arrived
 * PATCH /dispatch/:dispatch_id/clear    Clear unit (return to available)
 *
 * Dashboard dispatch endpoints:
 * POST  /dispatch/accept                Accept incident + assign units
 * POST  /dispatch/question              Ask caller a question via Nova Sonic
 * POST  /dispatch/escalate              Escalate — request additional units
 * POST  /dispatch/complete              Mark incident completed
 * POST  /dispatch/save-report           Save final report summary
 */

import {
  dbGetDispatchesForIncident,
  dbCreateDispatchAction,
  dbCreateDispatchQuestion,
  dbUpdateDispatchQuestion,
  getDb,
} from "../db/libsql.ts";
import {
  dispatchUnit,
  markUnitArrived,
  clearUnit,
  acceptIncident,
  escalateIncident,
  buildDispatchMessage,
} from "../services/dispatchService.ts";
import { pushSSE } from "../services/sseService.ts";
import { injectTextIntoSession } from "../agents/novaAgent.ts";
import { markDispatcherQuestionPending } from "../ws/callHandler.ts";
import { refineQuestion, extractAnswer } from "../agents/dispatchBridgeAgent.ts";
import { updateIncident, getIncident } from "../services/incidentService.ts";
import { generateCloseSummary } from "../agents/reportAgent.ts";
import type {
  UnitType,
  AcceptRequest,
  QuestionRequest,
  EscalateRequest,
  CompleteRequest,
  SaveReportRequest,
} from "../types/index.ts";

// ---------------------------------------------------------------------------
// Role guards
// ---------------------------------------------------------------------------

function requireRole(role: "dispatcher" | "unit_officer", suppliedRole: string | undefined): void {
  if (suppliedRole !== role) {
    throw Object.assign(new Error(`Action requires role: ${role}`), { status: 403 });
  }
}

function requireOwnIncident(
  suppliedRole: string | undefined,
  suppliedUnitId: string | undefined,
  assignedUnitsJson: string | null
): void {
  if (suppliedRole === "dispatcher") return;
  const assigned: string[] = assignedUnitsJson ? (JSON.parse(assignedUnitsJson) as string[]) : [];
  if (!suppliedUnitId || !assigned.includes(suppliedUnitId)) {
    throw Object.assign(new Error("You are not assigned to this incident"), { status: 403 });
  }
}

function requireOwnUnit(
  suppliedRole: string | undefined,
  suppliedUnitId: string | undefined,
  requestedUnitId: string
): void {
  if (suppliedRole === "dispatcher") return;
  if (suppliedUnitId !== requestedUnitId) {
    throw Object.assign(new Error("You can only assign yourself"), { status: 403 });
  }
}

// ---------------------------------------------------------------------------
// Helper to check for a role-guard error and return a 403 Response
// ---------------------------------------------------------------------------

function isForbiddenError(err: unknown): err is Error & { status: 403 } {
  return err instanceof Error && (err as Error & { status?: number }).status === 403;
}

export async function handleDispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Strip leading /dispatch
  const subPath = url.pathname.replace(/^\/dispatch\/?/, "");
  const parts = subPath ? subPath.split("/") : [];

  // ----- Dashboard dispatch routes (fixed sub-paths first) -----

  // POST /dispatch/accept
  if (req.method === "POST" && parts[0] === "accept") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as AcceptRequest;
    if (!input.incident_id || !Array.isArray(input.unit_ids) || !input.officer_id) {
      return badRequest("incident_id, unit_ids (array), and officer_id are required");
    }
    try {
      const result = await acceptIncident(input);
      // Inject message into active Nova Sonic session (non-fatal if not active)
      const depts = input.unit_ids.length > 0
        ? (await Promise.all(
          input.unit_ids.map(async (uid) => {
            const db = getDb();
            const { dbGetUnit } = await import("../db/libsql.ts");
            const unit = await dbGetUnit(db, uid);
            if (!unit) return null;
            // Reverse UnitType → Department label
            const dept = unit.type === "police" ? "patrol"
              : unit.type === "ems" ? "medical"
                : unit.type as "fire" | "hazmat";
            return dept;
          })
        )).filter((d): d is NonNullable<typeof d> => d !== null)
        : [];
      const message = buildDispatchMessage(depts);
      injectTextIntoSession(input.incident_id, message).catch(() => { /* non-fatal */ });
      pushSSE({ type: "transcript_annotation", data: { incident_id: input.incident_id, icon: "🚔", label: "Units dispatched", color: "cyan" } });
      return json({ ok: true, data: result }, 201);
    } catch (err) { return jsonError(err, 500); }
  }

  // POST /dispatch/question
  if (req.method === "POST" && parts[0] === "question") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as QuestionRequest;
    if (!input.incident_id || !input.question) {
      return badRequest("incident_id and question are required");
    }
    try {
      console.log(`[dispatch] POST /question received for incident ${input.incident_id}: "${input.question}"`);
      const db = getDb();

      // Role guard — unit officers can only ask questions on their own incident
      if (input.role) {
        const incidentForGuard = await getIncident(input.incident_id);
        try {
          requireOwnIncident(input.role, input.officer_id, incidentForGuard?.assigned_units ?? null);
        } catch (err) {
          if (isForbiddenError(err)) return json({ ok: false, error: (err as Error).message }, 403);
          throw err;
        }
      }

      // Log action
      await dbCreateDispatchAction(db, {
        incident_id: input.incident_id,
        action_type: "question",
        officer_id: input.officer_id,
        payload: { question: input.question },
      });

      // Save question to DB immediately so it appears in the UI right away.
      // Use the raw question as refined_question initially — background task will update it.
      const questionRecord = await dbCreateDispatchQuestion(db, {
        incident_id: input.incident_id,
        officer_id: input.officer_id,
        question: input.question,
        refined_question: input.question,
      });

      console.log(`[dispatch] Saved questionRecord ${questionRecord.id}. Starting async background task.`);

      // Emit annotation so live transcript shows the question was asked
      pushSSE({ type: "transcript_annotation", data: { incident_id: input.incident_id, icon: "📎", label: "Dispatcher asked a question", color: "yellow" } });

      // Respond to frontend immediately — button unsticks, question appears in list.
      // Refining + injecting into Nova happens in background (non-blocking).
      void (async () => {
        try {
          console.log(`[dispatch:bg] Refining question via Nova Lite...`);
          const refined = await refineQuestion(input.question, []);
          console.log(`[dispatch:bg] Refined as: "${refined}"`);

          // Flag the next agent turn as a dispatcher-question response so it
          // renders as a special annotation in the dispatcher transcript.
          markDispatcherQuestionPending(input.incident_id, refined);

          // Inject into active Nova Sonic session
          console.log(`[dispatch:bg] Injecting into Nova Sonic session (caller audio stream)...`);
          const injected = await injectTextIntoSession(input.incident_id, `Dispatcher question for caller: ${refined}`);
          console.log(`[dispatch:bg] Injection successful? ${injected}`);

          // If call is no longer active, try to find answer in existing transcript
          if (!injected) {
            console.log(`[dispatch:bg] Call not active. Running fallback extractAnswer on existing transcript.`);
            const { dbGetTranscription } = await import("../db/libsql.ts");
            const turns = await dbGetTranscription(db, input.incident_id);
            const simplified = turns.map((t) => ({ role: t.role, text: t.text }));
            const answer = await extractAnswer(input.question, simplified);
            if (answer) {
              console.log(`[dispatch:bg] Fallback found answer: "${answer}"`);
              await dbUpdateDispatchQuestion(db, questionRecord.id, answer);
              pushSSE({
                type: "answer_update",
                data: { incident_id: input.incident_id, question: input.question, answer },
              });
            }
          }
        } catch (err) {
          console.error("[dispatch/question] background refine/inject failed:", err instanceof Error ? err.message : String(err));
        }
      })();

      return json({ ok: true, data: questionRecord });
    } catch (err) { return jsonError(err, 500); }
  }

  // POST /dispatch/escalate
  if (req.method === "POST" && parts[0] === "escalate") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as EscalateRequest;
    if (!input.incident_id || !input.reason || !Array.isArray(input.requested_unit_types)) {
      return badRequest("incident_id, reason, and requested_unit_types are required");
    }
    try {
      // Role guard for escalate
      if ((input as unknown as Record<string, unknown>)["role"]) {
        const role = (input as unknown as Record<string, unknown>)["role"] as string;
        const officerId = (input as unknown as Record<string, unknown>)["officer_id"] as string | undefined;
        const incidentForGuard = await getIncident(input.incident_id);
        try {
          requireOwnIncident(role, officerId, incidentForGuard?.assigned_units ?? null);
        } catch (err) {
          if (isForbiddenError(err)) return json({ ok: false, error: (err as Error).message }, 403);
          throw err;
        }
      }
      const result = await escalateIncident(input);
      const message = buildDispatchMessage(input.requested_unit_types);
      injectTextIntoSession(input.incident_id, message).catch(() => { /* non-fatal */ });
      return json({ ok: true, data: result });
    } catch (err) { return jsonError(err, 500); }
  }

  // POST /dispatch/complete
  if (req.method === "POST" && parts[0] === "complete") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as CompleteRequest;
    if (!input.incident_id) return badRequest("incident_id is required");
    try {
      // Role guard for complete
      if ((input as unknown as Record<string, unknown>)["role"]) {
        const role = (input as unknown as Record<string, unknown>)["role"] as string;
        const officerId = (input as unknown as Record<string, unknown>)["officer_id"] as string | undefined;
        const incidentForGuard = await getIncident(input.incident_id);
        try {
          requireOwnIncident(role, officerId, incidentForGuard?.assigned_units ?? null);
        } catch (err) {
          if (isForbiddenError(err)) return json({ ok: false, error: (err as Error).message }, 403);
          throw err;
        }
      }
      const db = getDb();
      const now = new Date().toISOString();

      await dbCreateDispatchAction(db, {
        incident_id: input.incident_id,
        action_type: "complete",
        payload: { officer_notes: input.officer_notes ?? null },
      });

      const updated = await updateIncident(input.incident_id, {
        status: "completed",
        completed_at: now,
      });

      pushSSE({
        type: "status_change",
        data: { incident_id: input.incident_id, status: "completed" },
      });

      return json({ ok: true, data: { incident_id: input.incident_id, status: "completed", updated_at: updated?.updated_at ?? now } });
    } catch (err) { return jsonError(err, 500); }
  }

  // POST /dispatch/save-report
  if (req.method === "POST" && parts[0] === "save-report") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as SaveReportRequest;
    if (!input.incident_id) return badRequest("incident_id is required");
    try {
      const db = getDb();

      await dbCreateDispatchAction(db, {
        incident_id: input.incident_id,
        action_type: "save_report",
        payload: { summary: input.summary },
      });

      // Fetch transcript + dispatch actions for close summary generation
      const { dbGetTranscription, dbGetDispatchActions } = await import("../db/libsql.ts");
      const [turns, actions] = await Promise.all([
        dbGetTranscription(db, input.incident_id),
        dbGetDispatchActions(db, input.incident_id),
      ]);

      // Generate close summary via Nova Lite (non-fatal)
      let closeSummary: string = input.summary ?? "";
      try {
        const incident = await getIncident(input.incident_id);
        closeSummary = await generateCloseSummary(
          turns.map((t) => ({ role: t.role, text: t.text })),
          actions,
          input.summary,
          incident?.type ?? null,
          incident?.priority ?? null
        );
      } catch { /* use provided summary */ }

      const updated = await updateIncident(input.incident_id, { summary: closeSummary });

      pushSSE({
        type: "incident_completed",
        data: { incident_id: input.incident_id, summary: closeSummary },
      });

      return json({ ok: true, data: { incident_id: input.incident_id, summary: closeSummary, updated_at: updated?.updated_at } });
    } catch (err) { return jsonError(err, 500); }
  }

  // POST /dispatch/take  (Unit Officer self-assigns to an unassigned incident)
  if (req.method === "POST" && parts[0] === "take") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as import("../types/index.ts").TakeRequest;
    if (!input.incident_id || !input.unit_id) {
      return badRequest("incident_id and unit_id are required");
    }
    // Role check — unit officers only; must be taking themselves
    try {
      requireRole("unit_officer", input.role);
      requireOwnUnit(input.role, input.unit_id, input.unit_id);
    } catch (err) {
      if (isForbiddenError(err)) return json({ ok: false, error: err.message }, 403);
      throw err;
    }
    try {
      const db = getDb();
      const { dbGetUnit } = await import("../db/libsql.ts");
      const unit = await dbGetUnit(db, input.unit_id);
      if (!unit) return badRequest("Unit not found");
      if (unit.status !== "available" && unit.status !== ("on_duty" as string)) {
        return json({ ok: false, error: "Unit is not available" }, 409);
      }

      const incident = await getIncident(input.incident_id);
      if (!incident) return badRequest("Incident not found");
      const currentUnits: string[] = incident.assigned_units
        ? JSON.parse(incident.assigned_units)
        : [];
      if (currentUnits.length > 0) {
        return json({ ok: false, error: "Incident already has assigned units" }, 409);
      }

      const now = new Date().toISOString();
      const newUnits = [input.unit_id];

      await updateIncident(input.incident_id, {
        status: "dispatched",
        accepted_at: now,
        assigned_units: JSON.stringify(newUnits),
      });

      // Update unit status
      await db.execute({
        sql: "UPDATE units SET status = ?, current_incident_id = ?, updated_at = ? WHERE id = ?",
        args: ["dispatched", input.incident_id, now, input.unit_id],
      });

      // Insert incident_units record
      await db.execute({
        sql: "INSERT INTO incident_units (id, incident_id, unit_id, unit_type, status, dispatched_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [crypto.randomUUID(), input.incident_id, input.unit_id, unit.type, "dispatched", now],
      });

      // Build dispatch message and inject into Sonic (non-fatal)
      const dept = unit.type === "police" ? "patrol"
        : unit.type === "ems" ? "medical"
          : unit.type as "fire" | "hazmat";
      const message = buildDispatchMessage([dept]);
      injectTextIntoSession(input.incident_id, message).catch(() => { /* non-fatal */ });

      pushSSE({ type: "unit_dispatched", data: { incident_id: input.incident_id, unit_id: input.unit_id, unit_type: dept } });
      pushSSE({ type: "status_change", data: { incident_id: input.incident_id, status: "dispatched", unit_id: input.unit_id } });

      return json({ ok: true, data: { status: "dispatched", dispatch_message: message } }, 201);
    } catch (err) { return jsonError(err, 500); }
  }

  // POST /dispatch/backup-request  (Unit Officer requests backup from nearby units)
  if (req.method === "POST" && parts[0] === "backup-request") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as import("../types/index.ts").BackupRequestBody;
    if (!input.incident_id || !input.requesting_unit || !Array.isArray(input.requested_types) || !input.urgency) {
      return badRequest("incident_id, requesting_unit, requested_types, and urgency are required");
    }
    try {
      requireRole("unit_officer", input.role);
    } catch (err) {
      if (isForbiddenError(err)) return json({ ok: false, error: err.message }, 403);
      throw err;
    }
    try {
      const db = getDb();
      const { dbCreateBackupRequest } = await import("../db/libsql.ts");

      // Load incident to verify the requesting unit is assigned
      const incidentForGuard = await getIncident(input.incident_id);
      try {
        requireOwnIncident(input.role, input.requesting_unit, incidentForGuard?.assigned_units ?? null);
      } catch (err) {
        if (isForbiddenError(err)) return json({ ok: false, error: err.message }, 403);
        throw err;
      }

      // Find on-duty units to alert — alert all available units not on this incident
      const unitsResult = await db.execute({
        sql: `SELECT id, unit_code, type FROM units WHERE status = 'available' AND id != ? LIMIT 20`,
        args: [input.requesting_unit],
      });
      const alertedUnits = unitsResult.rows.map((r) => r.id as string);

      await dbCreateBackupRequest(db, {
        incident_id: input.incident_id,
        requesting_unit: input.requesting_unit,
        requested_types: input.requested_types,
        urgency: input.urgency,
        ...(input.message !== undefined ? { message: input.message } : {}),
        alerted_units: alertedUnits,
      });

      await dbCreateDispatchAction(db, {
        incident_id: input.incident_id,
        action_type: "escalate", // re-use closest existing type for audit
        officer_id: input.requesting_unit,
        payload: { backup_request: true, urgency: input.urgency, requested_types: input.requested_types },
      });

      pushSSE({
        type: "backup_requested",
        data: {
          incident_id: input.incident_id,
          requesting_unit: input.requesting_unit,
          requested_types: input.requested_types,
          urgency: input.urgency,
          message: input.message ?? "",
          target_units: alertedUnits,
        },
      } as any);

      return json({ ok: true, data: { status: "alert_sent", alerted_units: alertedUnits } }, 201);
    } catch (err) { return jsonError(err, 500); }
  }

  // POST /dispatch/backup-respond  (Another unit responds to a backup request)
  if (req.method === "POST" && parts[0] === "backup-respond") {
    let body: unknown;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON body"); }
    const input = body as import("../types/index.ts").BackupRespondBody;
    if (!input.incident_id || !input.responding_unit) {
      return badRequest("incident_id and responding_unit are required");
    }
    try {
      requireRole("unit_officer", input.role);
    } catch (err) {
      if (isForbiddenError(err)) return json({ ok: false, error: err.message }, 403);
      throw err;
    }
    try {
      const db = getDb();
      const { dbGetUnit, dbGetOpenBackupRequestForIncident, dbAddBackupResponder } = await import("../db/libsql.ts");

      const unit = await dbGetUnit(db, input.responding_unit);
      if (!unit) return badRequest("Unit not found");

      const now = new Date().toISOString();

      // Add unit to incident_units as secondary responder
      await db.execute({
        sql: "INSERT OR IGNORE INTO incident_units (id, incident_id, unit_id, unit_type, status, dispatched_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [crypto.randomUUID(), input.incident_id, input.responding_unit, unit.type, "dispatched", now],
      });

      // Update unit status
      await db.execute({
        sql: "UPDATE units SET status = ?, current_incident_id = ?, updated_at = ? WHERE id = ?",
        args: ["dispatched", input.incident_id, now, input.responding_unit],
      });

      // Update assigned_units on incident
      const incident = await getIncident(input.incident_id);
      if (incident) {
        const existing: string[] = incident.assigned_units ? JSON.parse(incident.assigned_units) : [];
        if (!existing.includes(input.responding_unit)) existing.push(input.responding_unit);
        await updateIncident(input.incident_id, { assigned_units: JSON.stringify(existing) });
      }

      // Log in backup_requests
      const backupReq = await dbGetOpenBackupRequestForIncident(db, input.incident_id);
      if (backupReq) {
        await dbAddBackupResponder(db, backupReq.id, input.responding_unit);
      }

      const dept = unit.type === "police" ? "patrol"
        : unit.type === "ems" ? "medical"
          : unit.type as "fire" | "hazmat";

      pushSSE({
        type: "backup_accepted",
        data: {
          incident_id: input.incident_id,
          responding_unit: input.responding_unit,
          responding_unit_type: dept,
        },
      } as any);

      pushSSE({ type: "status_change", data: { incident_id: input.incident_id, status: "dispatched", unit_id: input.responding_unit } });

      // Inject Sonic message (non-fatal)
      injectTextIntoSession(input.incident_id, "Additional units are en route to your location.").catch(() => { });

      return json({ ok: true, data: { status: "responding", incident_id: input.incident_id } }, 201);
    } catch (err) { return jsonError(err, 500); }
  }

  // ----- Existing routes -----

  // POST /dispatch — manual dispatch
  if (req.method === "POST" && parts.length === 0) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const input = body as { incident_id: string; unit_type: UnitType };
    if (!input.incident_id || !input.unit_type) {
      return badRequest("incident_id and unit_type are required");
    }

    try {
      const result = await dispatchUnit(input.incident_id, input.unit_type);
      return json({ ok: true, data: result }, 201);
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // GET /dispatch/:incident_id
  if (req.method === "GET" && parts.length === 1) {
    const incident_id = parts[0];
    if (!incident_id) return badRequest("Missing incident_id");

    const db = getDb();
    try {
      const dispatches = await dbGetDispatchesForIncident(db, incident_id);
      return json({ ok: true, data: dispatches });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // PATCH /dispatch/:dispatch_id/arrive
  if (req.method === "PATCH" && parts.length === 2 && parts[1] === "arrive") {
    const dispatch_id = parts[0];
    if (!dispatch_id) return badRequest("Missing dispatch_id");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const input = body as { unit_id: string };
    if (!input.unit_id) return badRequest("unit_id is required");

    try {
      await markUnitArrived(dispatch_id, input.unit_id);
      return json({ ok: true, data: { arrived: true } });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // PATCH /dispatch/:dispatch_id/clear
  if (req.method === "PATCH" && parts.length === 2 && parts[1] === "clear") {
    const dispatch_id = parts[0];
    if (!dispatch_id) return badRequest("Missing dispatch_id");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const input = body as { unit_id: string };
    if (!input.unit_id) return badRequest("unit_id is required");

    try {
      await clearUnit(dispatch_id, input.unit_id);
      return json({ ok: true, data: { cleared: true } });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  return notFound();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(err: unknown, status: number): Response {
  const message = err instanceof Error ? err.message : String(err);
  return json({ ok: false, error: message }, status);
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

function notFound(): Response {
  return json({ ok: false, error: "Not found" }, 404);
}
