import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createAnalytics } from '../analytics.mjs';
import { recommend } from '../core.mjs';
import {
  PROJECT_TOKEN, SDK_URL, createPostHogBridge, loadPostHog,
  posthogOptions, projectRecord, readAttribution,
} from '../posthog.mjs';

const ANONYMOUS_ID = '123e4567-e89b-42d3-a456-426614174000';
const APPROVED_EVENTS = [
  'finder_started', 'question_answered', 'finder_completed',
  'recommendation_viewed', 'recommendation_explanation_opened', 'outbound_affiliate_click',
];
const resultPayload = { state: 'RECOMMENDATIONS', toolId: 'descript', classification: 'ADD' };
const envelope = (event = 'finder_started', payload = {}, sequence = 1) => ({ version: 1, event, runId: 1, sequence, payload });
const payloadFor = event => event === 'finder_started' ? {}
  : event === 'question_answered' ? { question: 2 }
    : event === 'finder_completed' ? { state: 'RECOMMENDATIONS' } : { ...resultPayload };
const strictFields = (fields, reads = []) => new Proxy(fields, {
  get(target, key) {
    reads.push(key);
    assert.ok(Object.hasOwn(target, key), `Unexpected property read: ${String(key)}`);
    return target[key];
  },
  ownKeys() { throw new Error('Incoming objects must not be enumerated'); },
  getOwnPropertyDescriptor() { throw new Error('Incoming objects must not be copied or serialized'); },
});
const publish = (target, record) => {
  const event = new Event('stack-finder:analytics');
  Object.defineProperty(event, 'detail', { value: record });
  target.dispatchEvent(event);
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('PostHog event and property boundary', () => {
  test('All six approved events project only their required categorical fields', () => {
    for (const event of APPROVED_EVENTS) {
      assert.deepEqual(projectRecord(envelope(event, payloadFor(event))), {
        event, properties: { version: 1, runId: 1, sequence: 1, ...payloadFor(event) },
      });
    }
  });

  test('Unknown events are dropped before any other property is read', () => {
    for (const event of ['$pageview', '$autocapture', '$identify', '$snapshot', 'conversion', 'signup', 'revenue', 'commission', 'payout', '', null]) {
      const reads = [];
      assert.equal(projectRecord(strictFields({ event }, reads)), null);
      assert.deepEqual(reads, ['event']);
    }
  });

  test('Projection never enumerates a record or reads fields outside its event schema', () => {
    for (const event of APPROVED_EVENTS) {
      const payload = strictFields(payloadFor(event));
      const record = strictFields(envelope(event, payload));
      assert.deepEqual(projectRecord(record), {
        event, properties: { version: 1, runId: 1, sequence: 1, ...payloadFor(event) },
      });
    }
  });

  test('Private extras are ignored and malformed required fields fail closed', () => {
    const payload = { ...resultPayload };
    const record = envelope('recommendation_viewed', payload);
    for (const object of [record, payload]) {
      for (const key of ['email', 'freeText', 'answers', 'monthlyCost', 'budget', 'referralUrl', 'cookieWindow', 'commissionRate', '$set', 'toJSON']) {
        Object.defineProperty(object, key, { enumerable: true, get() { throw new Error(`Private field read: ${key}`); } });
      }
    }
    assert.deepEqual(projectRecord(record), {
      event: 'recommendation_viewed', properties: { version: 1, runId: 1, sequence: 1, ...resultPayload },
    });
    for (const value of [null, undefined, [], 'record', {}, { ...envelope(), version: 2 },
      { ...envelope(), runId: 0 }, { ...envelope(), runId: 1.5 },
      { ...envelope(), sequence: Number.MAX_SAFE_INTEGER + 1 },
      envelope('question_answered', { question: 6 }),
      envelope('question_answered', { question: '1' }),
      envelope('finder_completed', { state: 'some private text' }),
      envelope('recommendation_viewed', { ...resultPayload, toolId: 'person@example.invalid' }),
      envelope('recommendation_viewed', { ...resultPayload, classification: 'KEEP' }),
      { get event() { throw new Error('Unavailable event'); } }]) {
      assert.equal(projectRecord(value), null);
    }
  });
});

describe('PostHog attribution and final wire filtering', () => {
  test('Only known source, medium, and campaign values are retained', () => {
    const values = {
      utm_source: ['manual', 'facebook', 'instagram', 'threads', 'youtube'],
      utm_medium: ['qa', 'social', 'video'],
      utm_campaign: ['posthog_smoke', 'validation_30d'],
    };
    for (const [key, allowed] of Object.entries(values)) {
      for (const value of allowed) assert.deepEqual(readAttribution(`?${key}=${value}`), { [key]: value });
    }
    assert.deepEqual(readAttribution('?utm_source=manual&utm_medium=qa&utm_campaign=posthog_smoke&email=private&ref=secret'), {
      utm_source: 'manual', utm_medium: 'qa', utm_campaign: 'posthog_smoke',
    });
  });

  test('Unknown, duplicate, and free-text UTM values are omitted independently', () => {
    for (const search of ['', null, {}, '?utm_source=Manual&utm_medium=email&utm_campaign=private',
      '?utm_source=manual&utm_source=manual', '?utm_source=manual&utm_source=facebook',
      '?utm_medium=qa&utm_medium=qa', '?utm_campaign=posthog_smoke&utm_campaign=validation_30d']) {
      assert.deepEqual(readAttribution(search), {});
    }
    assert.deepEqual(readAttribution('?utm_source=manual&utm_source=unknown&utm_medium=qa&utm_campaign=validation_30d&utm_content=private'), {
      utm_medium: 'qa', utm_campaign: 'validation_30d',
    });
  });

  test('before_send removes SDK enrichment and identity changes while preserving transport identity', () => {
    const beforeSend = posthogOptions(ANONYMOUS_ID, '?utm_source=manual&utm_medium=qa').before_send;
    const properties = {
      version: 1, runId: 1, sequence: 3, ...resultPayload,
      token: 'untrusted-token', distinct_id: 'person@example.invalid',
      $current_url: 'https://example.invalid/private?q=secret', $referrer: 'https://private.invalid/',
      $browser: 'Browser', $device_id: 'device', $session_id: 'session', $lib: 'web',
      $set: { email: 'private' }, $set_once: { initial_url: 'private' },
      email: 'private', budget: 500, score: 35, affiliateUrl: 'https://example.invalid/ref',
      commissionRate: 0.9, utm_source: 'unapproved',
    };
    const output = beforeSend({ event: 'recommendation_viewed', properties, $set: { email: 'private' }, timestamp: 'private' });
    assert.deepEqual(output, {
      event: 'recommendation_viewed', properties: {
        version: 1, runId: 1, sequence: 3, ...resultPayload, utm_source: 'manual', utm_medium: 'qa',
        token: PROJECT_TOKEN, distinct_id: ANONYMOUS_ID, $process_person_profile: false,
      },
    });
    assert.equal(properties.distinct_id, 'person@example.invalid', 'Filtering must not mutate the SDK input');
    assert.equal(JSON.stringify(output).includes('private'), false);
  });

  test('before_send reads only approved properties, drops automatic events, and contains bad getters', () => {
    const beforeSend = posthogOptions(ANONYMOUS_ID).before_send;
    for (const event of APPROVED_EVENTS) {
      const properties = strictFields({ version: 1, runId: 1, sequence: 1, ...payloadFor(event) });
      const output = beforeSend(strictFields({ event, properties }));
      assert.equal(output?.event, event);
      assert.equal(output?.properties.distinct_id, ANONYMOUS_ID);
      assert.equal(output?.properties.token, PROJECT_TOKEN);
    }
    assert.equal(beforeSend(strictFields({ event: '$pageview' })), null);
    assert.equal(beforeSend({ event: 'finder_started', get properties() { throw new Error('No properties'); } }), null);
    for (const anonymousId of ['', null, 'person@example.invalid', 'device123']) {
      assert.equal(posthogOptions(anonymousId).before_send({ event: 'finder_started', properties: { version: 1, runId: 1, sequence: 1 } }), null);
    }
  });

  test('Automatic products, persistent identity, referrers, and campaign auto-capture are disabled', () => {
    const options = posthogOptions(ANONYMOUS_ID);
    for (const key of ['autocapture', 'capture_pageview', 'capture_pageleave', 'enable_heatmaps',
      'capture_performance', 'capture_exceptions', 'capture_dead_clicks', 'enable_recording_console_log',
      'rageclick', 'save_campaign_params', 'save_referrer', 'ip', 'request_batching']) assert.equal(options[key], false, key);
    for (const key of ['disable_session_recording', 'disable_surveys', 'advanced_disable_flags',
      'advanced_disable_decide', 'advanced_disable_feature_flags', 'disable_external_dependency_loading',
      'disable_persistence']) assert.equal(options[key], true, key);
    assert.equal(options.persistence, 'memory');
    assert.equal(options.person_profiles, 'identified_only');
    assert.deepEqual(options.bootstrap, { distinctID: ANONYMOUS_ID, isIdentifiedID: false });
    assert.equal(options.api_host, 'https://us.i.posthog.com');
  });
});

describe('PostHog bridge lifecycle', () => {
  test('All six events reach capture while provider claims and unknown events never do', async () => {
    const target = new EventTarget();
    const calls = [];
    const bridge = createPostHogBridge({ target, loadClient: () => ({ capture: (event, properties) => calls.push({ event, properties }) }) });
    await bridge.ready;
    for (const event of APPROVED_EVENTS) publish(target, envelope(event, payloadFor(event)));
    for (const event of ['signup', 'conversion', 'paid_conversion', 'approved_commission', 'revenue', 'cash_payout', '$pageview']) {
      publish(target, envelope(event, { ...resultPayload, revenue: 500 }));
    }
    assert.deepEqual(calls, APPROVED_EVENTS.map(event => ({ event, properties: { version: 1, runId: 1, sequence: 1, ...payloadFor(event) } })));
    bridge.stop();
  });

  test('Queued records are projected immediately, bounded to 100, and flushed in order', async () => {
    const target = new EventTarget();
    const loading = deferred();
    const calls = [];
    const bridge = createPostHogBridge({ target, loadClient: () => loading.promise, search: '?utm_source=manual' });
    const first = envelope('recommendation_viewed', { ...resultPayload }, 1);
    publish(target, first);
    first.runId = 999;
    first.payload.toolId = 'private changed value';
    for (let sequence = 2; sequence <= 150; sequence += 1) publish(target, envelope('finder_started', {}, sequence));
    assert.equal(calls.length, 0);
    loading.resolve({ capture: (event, properties) => calls.push({ event, properties }) });
    assert.equal(await bridge.ready, true);
    assert.equal(calls.length, 100);
    assert.deepEqual(calls.map(({ properties }) => properties.sequence), Array.from({ length: 100 }, (_, i) => i + 1));
    assert.equal(calls[0].properties.runId, 1);
    assert.equal(calls[0].properties.toolId, 'descript');
    assert.ok(calls.every(({ properties }) => properties.utm_source === 'manual'));
    publish(target, envelope('finder_started', {}, 151));
    assert.equal(calls.length, 101, 'A ready client is not subject to the pre-load queue limit');
    bridge.stop();
  });

  test('Repeated initialization on the same target reuses one bridge and listener', async () => {
    const target = new EventTarget();
    let loads = 0;
    const calls = [];
    const options = { target, loadClient() { loads += 1; return { capture: (...args) => calls.push(args) }; } };
    const first = createPostHogBridge(options);
    const second = createPostHogBridge(options);
    assert.equal(second, first);
    await first.ready;
    publish(target, envelope());
    assert.equal(loads, 1);
    assert.equal(calls.length, 1);
    first.stop();
  });

  test('Stop discards queued data and prevents capture after the SDK resolves', async () => {
    const target = new EventTarget();
    const loading = deferred();
    const calls = [];
    const bridge = createPostHogBridge({ target, loadClient: () => loading.promise });
    publish(target, envelope());
    bridge.stop();
    bridge.stop();
    loading.resolve({ capture: (...args) => calls.push(args) });
    assert.equal(await bridge.ready, false);
    publish(target, envelope());
    assert.equal(calls.length, 0);
  });

  test('Stopping an old bridge twice cannot unregister a replacement bridge', async () => {
    const target = new EventTarget();
    const first = createPostHogBridge({ target });
    first.stop();
    const replacement = createPostHogBridge({ target });
    first.stop();
    assert.equal(createPostHogBridge({ target }), replacement);
    await Promise.all([first.ready, replacement.ready]);
    replacement.stop();
  });

  test('Absent, throwing, and rejected loaders fail safely and discard pending records', async () => {
    for (const loadClient of [() => null, () => ({}), () => { throw new Error('Blocked SDK'); },
      () => Promise.reject(new Error('Offline SDK')), () => ({ get capture() { throw new Error('No client'); } })]) {
      const target = new EventTarget();
      const bridge = createPostHogBridge({ target, loadClient });
      publish(target, envelope());
      assert.equal(await bridge.ready, false);
      assert.doesNotThrow(() => publish(target, envelope()));
      bridge.stop();
    }
    const absent = createPostHogBridge();
    assert.equal(await absent.ready, false);
    assert.doesNotThrow(() => absent.stop());
  });

  test('Throwing and asynchronously rejected captures do not affect event dispatch', async () => {
    for (const capture of [() => { throw new Error('Capture failed'); }, () => Promise.reject(new Error('Request rejected'))]) {
      const target = new EventTarget();
      const bridge = createPostHogBridge({ target, loadClient: () => ({ capture }) });
      assert.equal(await bridge.ready, true);
      assert.doesNotThrow(() => publish(target, envelope()));
      await settle();
      bridge.stop();
    }
  });

  test('Malformed records are never queued or sent', async () => {
    const target = new EventTarget();
    const calls = [];
    const bridge = createPostHogBridge({ target, loadClient: () => ({ capture: (...args) => calls.push(args) }) });
    for (const record of [null, envelope('$autocapture'), envelope('question_answered', { question: 0 })]) publish(target, record);
    await bridge.ready;
    publish(target, envelope('conversion'));
    assert.equal(calls.length, 0);
    bridge.stop();
  });
});

describe('PostHog SDK loader', () => {
  const browserDouble = () => {
    const scripts = [];
    const view = { document: {
      createElement(tag) { assert.equal(tag, 'script'); return { remove() {} }; },
      head: { append(script) { scripts.push(script); } },
    } };
    return { view, scripts };
  };

  test('The pinned SDK is asynchronous and initializes a separate named instance', async () => {
    const { view, scripts } = browserDouble();
    const options = posthogOptions(ANONYMOUS_ID);
    const pending = loadPostHog(view, options);
    assert.equal(scripts.length, 1);
    const script = scripts[0];
    assert.equal(script.src, SDK_URL);
    assert.equal(script.async, true);
    assert.equal(script.referrerPolicy, 'no-referrer');
    assert.deepEqual(view.posthog._i, [[PROJECT_TOKEN, options, 'stackFinderValidation']]);
    const client = { capture() {} };
    view.posthog.stackFinderValidation = client;
    script.onload();
    assert.equal(await pending, client);
    assert.equal(script.onload, null);
    assert.equal(script.onerror, null);
  });

  test('A failed SDK load resolves without exposing a capture client', async () => {
    const { view, scripts } = browserDouble();
    const pending = loadPostHog(view, posthogOptions(ANONYMOUS_ID));
    scripts[0].onerror();
    assert.equal(await pending, null);
    assert.equal(scripts[0].onload, null);
    assert.equal(scripts[0].onerror, null);
    assert.equal(await loadPostHog(undefined, {}), null);
  });

  test('An existing host integration is neither borrowed nor reconfigured', async () => {
    const { view, scripts } = browserDouble();
    const hostClient = { capture() {} };
    view.posthog = hostClient;
    assert.equal(await loadPostHog(view, posthogOptions(ANONYMOUS_ID)), null);
    assert.equal(view.posthog, hostClient);
    assert.equal(scripts.length, 0);
  });

  test('A stalled SDK times out without leaving the bridge queue pending', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { view, scripts } = browserDouble();
    let removed = 0;
    const target = new EventTarget();
    const bridge = createPostHogBridge({ target, loadClient: () => loadPostHog(view, posthogOptions(ANONYMOUS_ID)) });
    publish(target, envelope());
    await Promise.resolve();
    scripts[0].remove = () => { removed += 1; };
    t.mock.timers.tick(8000);
    assert.equal(await bridge.ready, false);
    assert.equal(removed, 1);
    assert.equal(scripts[0].onload, null);
    assert.equal(scripts[0].onerror, null);
    assert.doesNotThrow(() => publish(target, envelope()));
    bridge.stop();
  });
});

describe('Recommendation independence from transport', () => {
  test('Engine output remains identical with an available or unavailable PostHog client', async () => {
    const captured = [];
    for (const enabled of [false, true]) {
      const target = new EventTarget();
      const options = posthogOptions(ANONYMOUS_ID);
      const bridge = createPostHogBridge({ target, loadClient: () => enabled ? {
        capture(event, properties) { captured.push(options.before_send({ event, properties })); },
      } : null });
      await bridge.ready;
      const analytics = createAnalytics({ emit: record => publish(target, record) });
      for (const primaryJob of ['general', 'video', 'voice', 'seo', 'coding', 'automation']) {
        const input = { primaryJob, existingTools: [], frequency: 'daily', budget: 150, biggestPain: 'time' };
        const result = recommend(input);
        const before = structuredClone(result);
        analytics.reset();
        analytics.start();
        analytics.completed(result.state);
        for (const recommendation of result.recommendations) analytics.recommendationViewed(recommendation, result.state);
        assert.deepEqual(result, before);
        assert.deepEqual(recommend(input), before);
      }
      bridge.stop();
    }
    assert.ok(captured.length > 0, 'The enabled case must exercise the transport');
    assert.ok(captured.every(record => record !== null));
  });
});
