/**
 * A bounded, in-memory client event contract. This module sends no requests,
 * persists nothing, and has no dependency on recommendation or pricing code.
 * Provider-side signups, conversions, commissions, revenue, and payouts are
 * separate facts: an outbound click can never create any of them here.
 */
export const ANALYTICS_EVENTS = Object.freeze([
  'finder_started',
  'question_answered',
  'finder_completed',
  'recommendation_viewed',
  'recommendation_explanation_opened',
  'outbound_affiliate_click',
]);

const STATES = new Set([
  'COVERED_BUY_NOTHING', 'RECOMMEND_GENERIC_GENERAL', 'REVIEW_OVERLAP',
  'COVERED_KEEP_EXISTING', 'RECOMMENDATIONS', 'BUDGET_CONSTRAINT',
  'NO_STRONG_RECOMMENDATION', 'CATALOG_GAP',
]);
const TOOL_IDS = new Set(['general-assistant', 'descript', 'elevenlabs', 'writesonic']);
const CLASSIFICATIONS = new Set(['ADD', 'TRY_FREE', 'OPTIONAL', 'SKIP']);
const OUTBOUND_STATES = new Set(['RECOMMENDATIONS', 'REVIEW_OVERLAP']);
const NOOP = () => {};

function safely(action, fallback = false) {
  try {
    return action();
  } catch {
    // Analytics is observational: malformed inputs and sinks cannot break UI.
    return fallback;
  }
}

function recommendationPayload(recommendation, state) {
  if (!recommendation || typeof recommendation !== 'object' || !STATES.has(state)) return null;
  // Read only approved categorical fields, never enumerate the source object.
  const toolId = recommendation.toolId;
  const classification = recommendation.status;
  return TOOL_IDS.has(toolId) && CLASSIFICATIONS.has(classification)
    ? { toolId, classification, state }
    : null;
}

function outboundPayload(anchor, configuration) {
  if (!configuration || configuration.approved !== true || configuration.buyNothing !== false) return null;
  const payload = recommendationPayload(configuration, configuration.state);
  if (!payload || payload.toolId === 'general-assistant' || !OUTBOUND_STATES.has(payload.state)
    || !['ADD', 'TRY_FREE'].includes(payload.classification)) return null;

  const view = anchor?.ownerDocument?.defaultView;
  if (!view || !(anchor instanceof view.HTMLAnchorElement) || !anchor.isConnected
    || anchor.hasAttribute('download')
    || anchor.closest('[disabled], [aria-disabled="true"], [hidden], [inert]')) return null;

  const configuredUrl = configuration.url;
  const rawHref = anchor.getAttribute('href');
  if (typeof configuredUrl !== 'string' || !configuredUrl || typeof rawHref !== 'string' || !rawHref) return null;
  // No base URL: relative and null URLs are intentionally invalid.
  const approvedUrl = new URL(configuredUrl);
  const actionUrl = new URL(rawHref);
  if (approvedUrl.protocol !== 'https:' || approvedUrl.username || approvedUrl.password
    || actionUrl.href !== approvedUrl.href || anchor.href !== approvedUrl.href
    || approvedUrl.origin === anchor.ownerDocument.location.origin) return null;
  return payload;
}

/**
 * Each start/reset cycle is a run. Within one run, questions count once each,
 * completion records only the first result state, and views/explanations count once
 * per state/tool/classification. Sequence numbers restart at one for each run.
 * Methods return true when emitted, false when ignored; reset returns nothing.
 */
export function createAnalytics(options = {}) {
  const emit = safely(() => {
    const candidate = options?.emit;
    return typeof candidate === 'function' ? candidate : NOOP;
  }, NOOP);
  let started = false;
  let runId = 0;
  let sequence = 0;
  let generation = 0;
  let recordedClicks = new WeakSet();
  const answered = new Set();
  let hasCompleted = false;
  const viewed = new Set();
  const explained = new Set();

  function dispatch(event, payload) {
    const envelope = Object.freeze({
      version: 1,
      event,
      runId,
      sequence: ++sequence,
      payload: Object.freeze(payload),
    });
    safely(() => {
      const pending = emit(envelope);
      // An optional async sink is contained just like a synchronous one.
      if (pending && typeof pending.catch === 'function') pending.catch(NOOP);
    });
    return true;
  }

  function recordRecommendation(event, seen, recommendation, state) {
    if (!started) return false;
    const payload = recommendationPayload(recommendation, state);
    if (!payload) return false;
    const key = `${payload.state}:${payload.toolId}:${payload.classification}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return dispatch(event, payload);
  }

  return Object.freeze({
    start() {
      if (started) return false;
      started = true;
      runId += 1;
      sequence = 0;
      return dispatch('finder_started', {});
    },

    reset() {
      started = false;
      sequence = 0;
      generation += 1;
      answered.clear();
      hasCompleted = false;
      viewed.clear();
      explained.clear();
      recordedClicks = new WeakSet();
    },

    questionAnswered(question) {
      if (!started || !Number.isInteger(question) || question < 1 || question > 5 || answered.has(question)) return false;
      answered.add(question);
      return dispatch('question_answered', { question });
    },

    completed(state) {
      if (!started || !STATES.has(state) || hasCompleted) return false;
      hasCompleted = true;
      return dispatch('finder_completed', { state });
    },

    recommendationViewed(recommendation, state) {
      return safely(() => recordRecommendation('recommendation_viewed', viewed, recommendation, state));
    },

    explanationOpened(recommendation, state) {
      return safely(() => recordRecommendation('recommendation_explanation_opened', explained, recommendation, state));
    },

    bindAffiliateClick(anchor, configuration) {
      return safely(() => {
        if (!outboundPayload(anchor, configuration)) return NOOP;
        let bound = true;
        const bindingGeneration = generation;
        const onClick = event => safely(() => {
          const view = anchor.ownerDocument.defaultView;
          if (!bound || !started || bindingGeneration !== generation || !(event instanceof view.MouseEvent) || !event.isTrusted
            || !((event.type === 'click' && event.button === 0) || (event.type === 'auxclick' && event.button === 1))) return;
          const eventRun = runId;
          // A later task observes cancellation by every native-event listener;
          // a microtask can run between listeners during browser dispatch.
          setTimeout(() => safely(() => {
            if (!bound || !started || runId !== eventRun || event.defaultPrevented || recordedClicks.has(event)) return;
            const payload = outboundPayload(anchor, configuration);
            if (!payload) return;
            recordedClicks.add(event);
            dispatch('outbound_affiliate_click', payload);
          }), 0);
        });
        anchor.addEventListener('click', onClick);
        anchor.addEventListener('auxclick', onClick);
        return () => {
          bound = false;
          safely(() => anchor.removeEventListener('click', onClick));
          safely(() => anchor.removeEventListener('auxclick', onClick));
        };
      }, NOOP);
    },
  });
}
