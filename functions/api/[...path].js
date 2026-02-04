export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Remove the "/api" prefix and forward the rest of the path
  const path = url.pathname.replace(/^\/api/, "");

  const targetUrl = "https://api.zanduelsdomain.app/api" + path + url.search;

  // Forward request (method/headers/body)
  const init = {
    method: context.request.method,
    headers: context.request.headers,
  };

  // Only attach body for non-GET/HEAD
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = context.request.body;
  }

  return fetch(targetUrl, init);
}
