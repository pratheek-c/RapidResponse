/**
 * Protocols REST routes.
 *
 * GET /protocols/search?q=query&limit=3    Search protocol chunks via RAG
 */

import { searchProtocols } from "../services/ragService.ts";

export async function handleProtocols(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const subPath = url.pathname.replace(/^\/protocols\/?/, "");

  if (req.method === "GET" && subPath === "search") {
    const q = url.searchParams.get("q");
    if (!q) return badRequest("Query parameter 'q' is required");

    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "3", 10), 10);

    try {
      const results = await searchProtocols(q, limit);
      return json({ ok: true, data: results });
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
