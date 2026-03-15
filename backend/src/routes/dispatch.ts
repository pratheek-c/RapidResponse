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
  dbCreateDispatch,
  dbGetDispatchesForIncident,
  dbCreateDispatchAction,
  dbCreateDispatchQuestion,
  dbUpdateDispatchQuestion,
  dbGetDispatchQuestions,
  getDb,
} from "../db/libsql.ts";
import {
  dispatchUnit,
  markUnitArrived,
  clearUnit,
  acceptIncident,
  escalateIncident,
  buildDispatchMessage,
  departmentToUnitType,
} from "../services/dispatchService.ts";
import { pushSSE } from "../services/sseService.ts";
import { injectTextIntoSession } from "../agents/novaAgent.ts";
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
      const db = getDb();

      // Log action
      await dbCreateDispatchAction(db, {
        incident_id: input.incident_id,
        action_type: "question",
        officer_id: input.officer_id,
        payload: { question: input.question },
      });

      // Refine the question for natural speech
      const refined = await refineQuestion(input.question, []);

      // Store question record
      const questionRecord = await dbCreateDispatchQuestion(db, {
        incident_id: input.incident_id,
        officer_id: input.officer_id,
        question: input.question,
        refined_question: refined,
      });

      // Inject into active Nova Sonic session
      const injected = await injectTextIntoSession(input.incident_id, `Dispatcher question for caller: ${refined}`);

      // If call is no longer active, try to find answer in existing transcript
      if (!injected) {
        const { dbGetTranscription } = await import("../db/libsql.ts");
        const turns = await dbGetTranscription(db, input.incident_id);
        const simplified = turns.map((t) => ({ role: t.role, text: t.text }));
        const answer = await extractAnswer(input.question, simplified);
        if (answer) {
          await dbUpdateDispatchQuestion(db, questionRecord.id, answer);
          pushSSE({
            type: "answer_update",
            data: { incident_id: input.incident_id, question: input.question, answer },
          });
          return json({ ok: true, data: { ...questionRecord, answer, injected: false } });
        }
      }

      return json({ ok: true, data: { ...questionRecord, injected } });
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
