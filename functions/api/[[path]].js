export async function onRequest(context) {
  const { request, params } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  const url = new URL(request.url);

  // params.path is an array for [[path]].js (multipath segments)
  const pieces = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const restPath = pieces.join("/"); // e.g. "products" or "stats/summary"

  // Forward to your real API
  const targetUrl = `https://api.zanduelsdomain.app/api/${restPath}${url.search}`;

  // Copy headers but avoid forwarding Host
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init = {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
    redirect: "follow",
  };

  const upstream = await fetch(targetUrl, init);

  // Return upstream response + CORS headers
  const outHeaders = new Headers(upstream.headers);
  const cors = corsHeaders(request);
  for (const [k, v] of cors.entries()) outHeaders.set(k, v);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  });
}
