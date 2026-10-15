import { ANALYTICS_EVENTS } from './analytics.mjs';

// Public browser token, not a Personal API Key. AI Stack Finder Validation (661807).
export const PROJECT_TOKEN = 'phc_B8waA6GmSKaNWwtVuNtnfsCUXcxvgTRZFSM2nrMWZaiJ';
export const SDK_URL = 'https://us-assets.i.posthog.com/static/1.380.0/array.js';
const EVENTS = new Set(ANALYTICS_EVENTS);
const STATES = new Set(['COVERED_BUY_NOTHING', 'COVERED_KEEP_EXISTING', 'REVIEW_OVERLAP',
  'RECOMMENDATIONS', 'BUDGET_CONSTRAINT', 'NO_STRONG_RECOMMENDATION', 'CATALOG_GAP', 'RECOMMEND_GENERIC_GENERAL']);
const TOOLS = new Set(['general-assistant', 'descript', 'elevenlabs', 'writesonic']);
const CLASSIFICATIONS = new Set(['ADD', 'TRY_FREE', 'OPTIONAL', 'SKIP']);
const UTM_VALUES = {
  utm_source: new Set(['manual', 'facebook', 'instagram', 'threads', 'youtube']),
  utm_medium: new Set(['qa', 'social', 'video']),
  utm_campaign: new Set(['posthog_smoke', 'validation_30d']),
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ordinal = value => Number.isSafeInteger(value) && value > 0;
const safely = (action, fallback = null) => { try { return action(); } catch { return fallback; } };

/** Project explicit fields only; never enumerate, spread, or serialize an incoming record. */
export function projectRecord(record) {
  return safely(() => {
    if (!object(record)) return null;
    const event = record.event;
    if (!EVENTS.has(event)) return null;
    const version = record.version;
    const runId = record.runId;
    const sequence = record.sequence;
    if (version !== 1 || !ordinal(runId) || !ordinal(sequence)) return null;
    const payload = record.payload;
    if (!object(payload)) return null;
    const properties = { version, runId, sequence };
    if (event === 'question_answered') {
      const question = payload.question;
      if (!Number.isInteger(question) || question < 1 || question > 5) return null;
      properties.question = question;
    } else if (event !== 'finder_started') {
      const state = payload.state;
      if (!STATES.has(state)) return null;
      properties.state = state;
      if (event !== 'finder_completed') {
        const toolId = payload.toolId;
        const classification = payload.classification;
        if (!TOOLS.has(toolId) || !CLASSIFICATIONS.has(classification)) return null;
        properties.toolId = toolId;
        properties.classification = classification;
      }
    }
    return { event, properties };
  });
}

/** Unknown values and ambiguous repeated parameters are omitted, never forwarded. */
export function readAttribution(search) {
  return safely(() => {
    if (typeof search !== 'string') return {};
    const query = new URLSearchParams(search);
    const attribution = {};
    for (const key of Object.keys(UTM_VALUES)) {
      const values = query.getAll(key);
      if (values.length === 1 && UTM_VALUES[key].has(values[0])) attribution[key] = values[0];
    }
    return attribution;
  }, {});
}

/** Final wire boundary: discard SDK-enriched properties and all non-contract events. */
export function posthogOptions(anonymousId, search = '') {
  const attribution = readAttribution(search);
  return {
    api_host: 'https://us.i.posthog.com',
    ui_host: 'https://us.posthog.com',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    enable_heatmaps: false,
    disable_surveys: true,
    advanced_disable_flags: true,
    advanced_disable_decide: true, // Compatibility with the pinned v1 SDK.
    advanced_disable_feature_flags: true,
    disable_external_dependency_loading: true,
    capture_performance: false,
    capture_exceptions: false,
    capture_dead_clicks: false,
    enable_recording_console_log: false,
    rageclick: false,
    person_profiles: 'identified_only',
    persistence: 'memory',
    disable_persistence: true,
    save_campaign_params: false,
    save_referrer: false,
    ip: false,
    request_batching: false,
    bootstrap: { distinctID: anonymousId, isIdentifiedID: false },
    before_send: sdkEvent => safely(() => {
      if (!object(sdkEvent)) return null;
      const event = sdkEvent.event;
      if (!EVENTS.has(event)) return null;
      const input = sdkEvent.properties;
      if (!object(input)) return null;
      const projected = projectRecord({ event, version: input.version, runId: input.runId,
        sequence: input.sequence, payload: input });
      if (!projected || typeof anonymousId !== 'string'
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(anonymousId)) return null;
      // All spreads here are newly created allowlisted objects. Never retain $set,
      // $set_once, URLs, referrers, device/session properties, or identity from the SDK.
      return { event: projected.event, properties: { ...projected.properties, ...attribution,
        token: PROJECT_TOKEN, distinct_id: anonymousId, $process_person_profile: false } };
    }),
  };
}

const bridges = new WeakMap();

/** Listen immediately; SDK loading never blocks the UI. At most 100 clean records wait in memory. */
export function createPostHogBridge({ target, loadClient = () => null, search = '' } = {}) {
  if (!target || typeof target.addEventListener !== 'function') return { ready: Promise.resolve(false), stop() {} };
  if (bridges.has(target)) return bridges.get(target);
  const attribution = readAttribution(search);
  let active = true;
  let loading = true;
  let client = null;
  const queue = [];
  const capture = record => safely(() => {
    if (!active || !client) return;
    const pending = client.capture(record.event, { ...record.properties, ...attribution });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  });
  const listener = event => safely(() => {
    const record = projectRecord(event.detail);
    if (!record || !active) return;
    if (loading) {
      if (queue.length < 100) queue.push(record);
    } else capture(record);
  });
  target.addEventListener('stack-finder:analytics', listener);
  const bridge = {
    ready: Promise.resolve().then(loadClient).then(loaded => {
      loading = false;
      if (active && loaded && typeof loaded.capture === 'function') client = loaded;
      for (const record of queue.splice(0)) capture(record);
      return Boolean(client);
    }).catch(() => { loading = false; queue.length = 0; return false; }),
    stop() {
      if (!active) return;
      active = false;
      client = null;
      queue.length = 0;
      target.removeEventListener('stack-finder:analytics', listener);
      bridges.delete(target);
    },
  };
  bridges.set(target, bridge);
  return bridge;
}

/** A named SDK instance keeps this transport separate from other page integrations. */
export function loadPostHog(view, options) {
  return new Promise(resolve => {
    let script;
    let timer;
    let finished = false;
    const finish = client => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (script) { script.onload = null; script.onerror = null; }
      resolve(client);
    };
    safely(() => {
      // Do not borrow an unknown host integration or reconfigure its automatic collection.
      if (view.posthog) { finish(null); return; }
      // The vendor snippet's initialization queue, with no unvalidated capture queue.
      view.posthog = [];
      view.posthog._i = [[PROJECT_TOKEN, options, 'stackFinderValidation']];
      view.posthog.__SV = 1;
      script = view.document.createElement('script');
      script.async = true;
      script.src = SDK_URL;
      script.referrerPolicy = 'no-referrer';
      script.onload = () => finish(safely(() => view.posthog.stackFinderValidation));
      script.onerror = () => finish(null);
      timer = setTimeout(() => { script.remove(); finish(null); }, 8000);
      view.document.head.append(script);
    }, false) === false && finish(null);
  });
}

// This independent module is loaded before ui.js, without changing the local event contract.
if (typeof document !== 'undefined') safely(() => {
  const target = document.getElementById('stack-finder');
  const view = document.defaultView;
  if (!target || !view?.crypto?.randomUUID) return;
  const anonymousId = view.crypto.randomUUID();
  const search = view.location.search;
  createPostHogBridge({ target, search, loadClient: () => loadPostHog(view, posthogOptions(anonymousId, search)) });
});
