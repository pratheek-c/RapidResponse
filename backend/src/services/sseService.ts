/**
 * SSE (Server-Sent Events) service.
 *
 * Maintains a registry of active dispatcher dashboard clients.
 * Broadcasts structured SseEvent objects to all connected clients.
 *
 * Usage in server.ts:
 *   GET /events — call sseRegister(req, res) to add client
 *   Anywhere    — call sseBroadcast(event) to push to all clients
 */

import type { SseEvent, SseEventType, DashboardSSEEvent } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Client registry
// ---------------------------------------------------------------------------

type SseClient = {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const clients = new Map<string, SseClient>();

/** Register a new SSE client. Returns the Response to send back. */
export function sseRegister(): { response: Response; clientId: string } {
  const clientId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clients.set(clientId, { id: clientId, controller });

      // Initial ping to confirm connection
      const ping = encodeSSE({ type: "ping", data: {} });
      controller.enqueue(new TextEncoder().encode(ping));
    },
    cancel() {
      clients.delete(clientId);
    },
  });

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });

  return { response, clientId };
}

/** Remove a client explicitly (e.g. on connection close). */
export function sseUnregister(clientId: string): void {
  const client = clients.get(clientId);
  if (client) {
    try {
      client.controller.close();
    } catch {
      // Already closed — ignore
    }
    clients.delete(clientId);
  }
}

/** Returns the current number of connected SSE clients. */
export function sseClientCount(): number {
  return clients.size;
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

/** Push an event to all connected dashboard clients. */
export function sseBroadcast(event: SseEvent): void {
  if (clients.size === 0) return;

  const payload = encodeSSE({
    type: event.type,
    data: {
      incident_id: event.incident_id,
      payload: event.payload,
      timestamp: event.timestamp,
    },
  });

  const encoded = new TextEncoder().encode(payload);
  const dead: string[] = [];

  for (const [id, client] of clients) {
    try {
      client.controller.enqueue(encoded);
    } catch {
      dead.push(id);
    }
  }

  for (const id of dead) {
    clients.delete(id);
  }
}

/** Build a typed SSE event and broadcast it. */
export function sseSend(
  type: SseEventType,
  incident_id: string,
  payload: unknown
): void {
  sseBroadcast({
    type,
    incident_id,
    payload,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function encodeSSE(message: { type: string; data: unknown }): string {
  const json = JSON.stringify({ event: message.type, ...message.data });
  return `event: ${message.type}\ndata: ${json}\n\n`;
}

// ---------------------------------------------------------------------------
// Dashboard typed push (new dispatch events)
// ---------------------------------------------------------------------------

/**
 * Push a typed DashboardSSEEvent to all connected clients.
 * Wire format: `event: <type>\ndata: <JSON of data field>\n\n`
 */
export function pushSSE(event: DashboardSSEEvent): void {
  if (clients.size === 0) return;

  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  const encoded = new TextEncoder().encode(payload);
  const dead: string[] = [];

  for (const [id, client] of clients) {
    try {
      client.controller.enqueue(encoded);
    } catch {
      dead.push(id);
    }
  }

  for (const id of dead) {
    clients.delete(id);
  }
}
