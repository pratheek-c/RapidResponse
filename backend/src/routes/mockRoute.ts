/**
 * Mock data route.
 *
 * GET /mock/dispatchers — returns dispatchers, zones, and hospitals from the
 * static mock JSON file (backend/data/mock/dispatchers.json) for the
 * dispatcher dashboard.
 */

import dispatchersJson from "../../data/mock/dispatchers.json";

export async function handleMock(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/mock/dispatchers" && req.method === "GET") {
    const data = {
      dispatchers: dispatchersJson.dispatchers,
      zones: dispatchersJson.zones,
      hospitals: dispatchersJson.hospitals,
    };
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
