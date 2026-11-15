import { createPostHogBridge, posthogOptions } from './posthog.mjs';

export const CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/?ip=0';
const controllers = new WeakMap();
const safely = (action, fallback = false) => { try { return action(); } catch { return fallback; } };
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

/**
 * Consent is page-memory only. No identity, SDK, event queue, or network request
 * exists before allow(). Only events observed after allow() can reach the bridge.
 * Each request is abortable, times out after eight seconds, and is never retried.
 */
export function createConsentAnalytics({ target, view } = {}) {
  if (!target || typeof target.addEventListener !== 'function') {
    return { isAllowed: () => false, allow: () => false, decline() {}, dispose() {} };
  }
  if (controllers.has(target)) return controllers.get(target);
  let allowed = false;
  let disposed = false;
  let generation = 0;
  let bridge = null;
  const pending = new Map();

  function decline() {
    allowed = false;
    generation += 1;
    bridge?.stop();
    bridge = null;
    for (const cancel of pending.values()) cancel();
    pending.clear();
  }

  const consent = {
    isAllowed: () => allowed && !disposed,
    allow() {
      if (disposed) return false;
      if (allowed) return true;
      const started = safely(() => {
        if (typeof view?.fetch !== 'function' || typeof view?.AbortController !== 'function'
          || typeof view?.crypto?.randomUUID !== 'function') return false;
        const id = view.crypto.randomUUID();
        if (!validId(id)) return false;
        const search = safely(() => view.location.search, '');
        const filter = posthogOptions(id, search).before_send;
        const epoch = ++generation;
        allowed = true;
        const client = {
          capture(event, properties) {
            if (!allowed || disposed || epoch !== generation) return;
            const record = filter({ event, properties });
            if (!record) return;
            // filter() returns a new allowlisted object. The public project token
            // and transient ID belong in the documented Capture API envelope.
            const { token, distinct_id, ...cleanProperties } = record.properties;
            const request = new view.AbortController();
            const timer = setTimeout(() => {
              safely(() => request.abort());
              pending.delete(request);
            }, 8000);
            const finish = () => { clearTimeout(timer); pending.delete(request); };
            pending.set(request, () => { clearTimeout(timer); safely(() => request.abort()); });
            try {
              Promise.resolve(view.fetch(CAPTURE_URL, {
                method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
                redirect: 'error', referrerPolicy: 'no-referrer', keepalive: false,
                headers: { 'Content-Type': 'application/json' }, signal: request.signal,
                body: JSON.stringify({ api_key: token, event: record.event,
                  distinct_id, properties: cleanProperties }),
              })).catch(() => {}).finally(finish);
            } catch {
              finish(); // A synchronous transport failure is also observational.
            }
          },
        };
        bridge = createPostHogBridge({ target, search, loadClient: () => client });
        return true;
      });
      if (started !== true) decline();
      return started === true;
    },
    decline,
    dispose() {
      if (disposed) return;
      decline();
      disposed = true;
      controllers.delete(target);
    },
  };
  controllers.set(target, consent);
  return consent;
}