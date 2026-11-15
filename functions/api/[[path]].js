// Public preview adapter: a single anonymous, read-only catalog endpoint.
// Do not forward visitor credentials, query strings, or upstream cookies/CORS.
export async function onRequest({ request }) {
  const url = new URL(request.url);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const reply = (body, status, extra = {}) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, ...extra },
  });
  if (url.pathname !== '/api/products' || url.search) {
    return reply({ error: 'Not found' }, 404);
  }
  if (request.method !== 'GET') {
    return reply({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  }
  // Same-origin callers need no CORS. Reject explicit cross-origin callers too.
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return reply({ error: 'Cross-origin requests are not allowed' }, 403);
  }
  try {
    const upstream = await fetch('https://api.zanduelsdomain.app/api/products', {
      method: 'GET', headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
    if (!upstream.ok || !upstream.headers.get('content-type')?.includes('application/json')) {
      return reply({ error: 'Catalog unavailable' }, 502);
    }
    const data = await upstream.json();
    const items = Array.isArray(data) ? data : data?.items ?? data?.products;
    if (!Array.isArray(items)) return reply({ error: 'Catalog unavailable' }, 502);
    const normalized = items.map(p => ({
      ...p, title: p?.title ?? p?.name ?? '',
      image: p?.image ?? p?.image_url ?? '',
      description: p?.description ?? p?.short_desc ?? p?.long_desc ?? '',
    }));
    return reply({ items: normalized, products: normalized }, 200);
  } catch {
    return reply({ error: 'Catalog unavailable' }, 502);
  }
}
