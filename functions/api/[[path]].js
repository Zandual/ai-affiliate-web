export async function onRequest(context) {
  const { request, params } = context;

  // ============================================================
  // EDUCATIONAL NOTE: Why this function exists
  // ------------------------------------------------------------
  // Cloudflare Pages Functions can act as an "API adapter".
  // That means we can:
  //  - proxy requests to a real backend
  //  - add CORS headers
  //  - normalize response shapes so the frontend never breaks
  //
  // Your /products endpoint returns:
  //   { items: [...] }
  //
  // But many frontends expect either:
  //   [...]                (a plain array)
  //   or { products: [...] }
  //
  // So below we normalize /products into:
  //   { items: [...], products: [...] }
  // ============================================================

  // Handle CORS preflight (browser asks permission before requests)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  const url = new URL(request.url);

  // params.path is an array for [[path]].js (catch-all segments)
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

  // Always attach CORS headers to the final response
  const outHeaders = new Headers(upstream.headers);
  const cors = corsHeaders(request);
  for (const [k, v] of cors.entries()) outHeaders.set(k, v);

  // ------------------------------------------------------------
  // IMPORTANT: Normalize the /products response shape
  // ------------------------------------------------------------
  const contentType = upstream.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const isProductsEndpoint = /^products(\/|$)/.test(restPath);

  // Only attempt JSON parsing when:
  //  - upstream is JSON
  //  - this is the products endpoint
  //  - upstream returned a "successful" response
  if (isJson && isProductsEndpoint && upstream.ok) {
    let data;
    try {
      data = await upstream.json();
    } catch (e) {
      // If parsing fails, fall back to passing the response through
      return new Response(upstream.body, {
        status: upstream.status,
        headers: outHeaders,
      });
    }

    // Accept multiple possible shapes from upstream
    // - { items: [...] }
    // - { products: [...] }
    // - [...]  (already an array)
    let items = [];
    if (Array.isArray(data)) items = data;
    else if (data && Array.isArray(data.items)) items = data.items;
    else if (data && Array.isArray(data.products)) items = data.products;

    // Optional normalization:
    // Map fields to names many frontends use (title/image/description)
    // This does NOT remove your original fields — it adds extra friendly aliases.
    const normalized = items.map((p) => ({
      ...p,
      title: p?.title ?? p?.name ?? "",
      image: p?.image ?? p?.image_url ?? "",
      description: p?.description ?? p?.short_desc ?? p?.long_desc ?? "",
    }));

    // Return BOTH keys so whichever your frontend expects will work.
    const payload = {
      items: normalized,
      products: normalized,
    };

    outHeaders.set("content-type", "application/json; charset=utf-8");

    return new Response(JSON.stringify(payload), {
      status: upstream.status,
      headers: outHeaders,
    });
  }

  // Default: pass through upstream response body unchanged
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
