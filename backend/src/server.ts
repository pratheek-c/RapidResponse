/**
 * Bun HTTP + WebSocket server.
 *
 * Uses Bun.serve() — no express, no ws package.
 * Handles:
 *   GET  /events           SSE stream for dispatcher dashboard
 *   WS   /call             WebSocket endpoint for emergency calls
 *   GET  /incidents[/:id]  Incident REST API
 *   POST/GET /units[/:id]  Units REST API
 *   POST/GET /dispatch     Dispatch REST API
 *   GET  /protocols/search Protocol RAG search
 *   GET  /recordings/...   Audio/transcript presigned URLs
 *   GET  /health           Health check
 */

import { env } from "./config/env.ts";
import { sseRegister } from "./services/sseService.ts";
import { handleIncidents } from "./routes/incidents.ts";
import { handleUnits } from "./routes/units.ts";
import { handleDispatch } from "./routes/dispatch.ts";
import { handleProtocols } from "./routes/protocols.ts";
import { handleRecordings } from "./routes/recordings.ts";
import { handleReport } from "./routes/reportRoute.ts";
import { handleMock } from "./routes/mockRoute.ts";
import {
  onMessage,
  onClose,
  type BunServerWebSocket,
} from "./ws/callHandler.ts";

// Per-socket call state
type SocketData = {
  current: import("./ws/callHandler.ts").CallState | null;
};

// Re-export CallState to satisfy TS import
export type { SocketData };

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------

function getAllowedOrigin(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  // Allow any localhost port in dev; fall back to configured FRONTEND_URL in prod
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return env.FRONTEND_URL;
}

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(req),
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function withCors(response: Response, req: Request): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(req))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

// ---------------------------------------------------------------------------
// HTTP router
// ---------------------------------------------------------------------------

async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  // Health check
  if (path === "/health") {
    return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // SSE
  if (path === "/events" && req.method === "GET") {
    const { response } = sseRegister();
    return withCors(response, req);
  }

  // Incidents
  if (path.startsWith("/incidents")) {
    return withCors(await handleIncidents(req), req);
  }

  // Units
  if (path.startsWith("/units")) {
    return withCors(await handleUnits(req), req);
  }

  // Dispatch
  if (path.startsWith("/dispatch")) {
    return withCors(await handleDispatch(req), req);
  }

  // Protocols
  if (path.startsWith("/protocols")) {
    return withCors(await handleProtocols(req), req);
  }

  // Recordings
  if (path.startsWith("/recordings")) {
    return withCors(await handleRecordings(req), req);
  }

  // Report
  if (path.startsWith("/report")) {
    return withCors(await handleReport(req), req);
  }

  // Mock data
  if (path.startsWith("/mock")) {
    return withCors(await handleMock(req), req);
  }

  return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createServer() {
  return Bun.serve<SocketData>({
    port: env.PORT,
    idleTimeout: 255, // max allowed by Bun; SSE connections handled below

    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade for /call
      if (url.pathname === "/call") {
        const upgraded = server.upgrade(req, {
          data: { current: null },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 426 });
      }

      try {
        return await router(req);
      } catch (err) {
        console.error("[server] unhandled error:", err);
        return new Response(
          JSON.stringify({ ok: false, error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    },

    websocket: {
      open(_ws) {
        // Socket opened — state is already initialised in data
      },

      async message(ws, raw) {
        await onMessage(
          ws as unknown as BunServerWebSocket,
          typeof raw === "string" ? raw : Buffer.from(raw),
          ws.data
        );
      },

      async close(ws) {
        await onClose(ws as unknown as BunServerWebSocket, ws.data);
      },
    },
  });
}
