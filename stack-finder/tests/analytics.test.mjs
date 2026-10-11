import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ANALYTICS_EVENTS, createAnalytics } from '../analytics.mjs';
import { CATALOG } from '../catalog.mjs';
import { recommend } from '../core.mjs';

const EVENT_NAMES = [
  'finder_started',
  'question_answered',
  'finder_completed',
  'recommendation_viewed',
  'recommendation_explanation_opened',
  'outbound_affiliate_click',
];
const STATES = [
  'COVERED_BUY_NOTHING', 'COVERED_KEEP_EXISTING', 'REVIEW_OVERLAP',
  'RECOMMENDATIONS', 'RECOMMEND_GENERIC_GENERAL', 'BUDGET_CONSTRAINT',
  'NO_STRONG_RECOMMENDATION', 'CATALOG_GAP',
];
const TOOL_IDS = ['general-assistant', 'descript', 'elevenlabs', 'writesonic'];
const CLASSIFICATIONS = ['ADD', 'TRY_FREE', 'OPTIONAL', 'SKIP'];
const candidate = (toolId = 'descript', status = 'ADD') => ({ toolId, status });
const setup = () => {
  const records = [];
  const analytics = createAnalytics({ emit: (record) => records.push(record) });
  return { analytics, records };
};
const recordsOf = (records, event) => records.filter((record) => record.event === event);
const keys = (value) => Object.keys(value).sort();
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

describe('analytics schema and privacy', () => {
  test('The only supported events are the six Issue #6 events', () => {
    assert.deepEqual(Object.values(ANALYTICS_EVENTS).sort(), [...EVENT_NAMES].sort());
    assert.equal(new Set(Object.values(ANALYTICS_EVENTS)).size, 6);
    assert.ok(Object.isFrozen(ANALYTICS_EVENTS));
    assert.ok(EVENT_NAMES.every((name) => !/signup|conversion|revenue|commission|payout/i.test(name)));
  });

  test('A completed journey emits only the frozen envelope and categorical payload', () => {
    const { analytics, records } = setup();
    analytics.start();
    for (let question = 1; question <= 5; question += 1) analytics.questionAnswered(question);
    analytics.completed('RECOMMENDATIONS');
    analytics.recommendationViewed(candidate(), 'RECOMMENDATIONS');
    analytics.explanationOpened(candidate(), 'RECOMMENDATIONS');

    assert.deepEqual(records.map(({ event }) => event), [
      'finder_started', ...Array(5).fill('question_answered'), 'finder_completed',
      'recommendation_viewed', 'recommendation_explanation_opened',
    ]);
    assert.deepEqual(records.map(({ sequence }) => sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(records[0].payload, {});
    assert.deepEqual(records.slice(1, 6).map(({ payload }) => payload), [1, 2, 3, 4, 5].map((question) => ({ question })));
    assert.deepEqual(records[6].payload, { state: 'RECOMMENDATIONS' });
    assert.deepEqual(records[7].payload, { toolId: 'descript', classification: 'ADD', state: 'RECOMMENDATIONS' });
    assert.deepEqual(records[8].payload, records[7].payload);
    for (const record of records) {
      assert.deepEqual(keys(record), ['event', 'payload', 'runId', 'sequence', 'version']);
      assert.equal(record.version, 1);
      assert.ok(Number.isInteger(record.runId) && record.runId > 0);
      assert.equal(record.runId, records[0].runId);
      assert.ok(Object.isFrozen(record));
      assert.ok(Object.isFrozen(record.payload));
    }
  });

  test('All eight core states and only the four recommendation classifications can be represented', () => {
    const { analytics, records } = setup();
    for (const state of STATES) {
      analytics.reset();
      analytics.start();
      analytics.completed(state);
    }
    for (const toolId of TOOL_IDS) {
      for (const status of CLASSIFICATIONS) analytics.recommendationViewed(candidate(toolId, status), 'RECOMMENDATIONS');
    }
    assert.deepEqual(recordsOf(records, 'finder_completed').map(({ payload }) => payload.state), STATES);
    assert.equal(recordsOf(records, 'recommendation_viewed').length, TOOL_IDS.length * CLASSIFICATIONS.length);
  });

  test('Free text, costs, scores, URLs, answers, and affiliate economics are never read or forwarded', () => {
    const { analytics, records } = setup();
    const projected = candidate();
    const privateFields = ['email', 'freeText', 'answers', 'existingTools', 'monthlyCost', 'budget',
      'score', 'scoreBreakdown', 'reasons', 'affiliate', 'affiliateStatus', 'referralUrl',
      'commissionRate', 'cookieWindow', 'attributionWindow', 'payoutTerms'];
    for (const key of privateFields) {
      Object.defineProperty(projected, key, {
        enumerable: true,
        get() { throw new Error(`Private field read: ${key}`); },
      });
    }
    analytics.start();
    assert.equal(analytics.recommendationViewed(projected, 'RECOMMENDATIONS'), true);
    assert.equal(analytics.explanationOpened(projected, 'RECOMMENDATIONS'), true);
    for (const record of records.slice(1)) {
      assert.deepEqual(record.payload, { toolId: 'descript', classification: 'ADD', state: 'RECOMMENDATIONS' });
      for (const key of privateFields) assert.equal(Object.hasOwn(record.payload, key), false);
    }
  });

  test('Tool IDs cannot carry arbitrary free text or personally identifying data', () => {
    const { analytics, records } = setup();
    analytics.start();
    for (const toolId of ['chatgpt', 'other', 'person@example.invalid', 'my-private-tool', '', ' descript ', '__proto__']) {
      assert.equal(analytics.recommendationViewed(candidate(toolId), 'RECOMMENDATIONS'), false);
      assert.equal(analytics.explanationOpened(candidate(toolId), 'RECOMMENDATIONS'), false);
    }
    assert.equal(records.length, 1);
  });

  test('Question payloads contain the question number, never the answer', () => {
    const { analytics, records } = setup();
    analytics.start();
    const extras = { answer: 'private free text', monthlyCost: 123.45, referralUrl: 'https://example.invalid/private' };
    analytics.questionAnswered(2, extras);
    assert.deepEqual(records[1].payload, { question: 2 });
    assert.equal(JSON.stringify(records).includes('private'), false);
  });
});

describe('analytics lifecycle and deduplication', () => {
  test('Start, question, completion, view, and explanation events deduplicate within a run', () => {
    const { analytics, records } = setup();
    assert.equal(analytics.start(), true);
    assert.equal(analytics.start(), false);
    for (const emit of [
      () => analytics.questionAnswered(1),
      () => analytics.completed('RECOMMENDATIONS'),
      () => analytics.recommendationViewed(candidate(), 'RECOMMENDATIONS'),
      () => analytics.explanationOpened(candidate(), 'RECOMMENDATIONS'),
    ]) {
      assert.equal(emit(), true);
      assert.equal(emit(), false);
    }
    assert.equal(records.length, 5);
    assert.deepEqual(records.map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
  });

  test('Completion is once per run even when the result state changes', () => {
    const { analytics, records } = setup();
    analytics.start();
    assert.equal(analytics.completed('RECOMMENDATIONS'), true);
    for (const state of ['RECOMMENDATIONS', 'CATALOG_GAP', 'BUDGET_CONSTRAINT', 'RECOMMENDATIONS']) {
      assert.equal(analytics.completed(state), false);
    }
    assert.deepEqual(recordsOf(records, 'finder_completed').map(({ payload }) => payload.state), ['RECOMMENDATIONS']);
    analytics.reset();
    analytics.start();
    assert.equal(analytics.completed('CATALOG_GAP'), true);
    assert.equal(analytics.completed('RECOMMENDATIONS'), false);
    assert.deepEqual(recordsOf(records, 'finder_completed').map(({ payload }) => payload.state), ['RECOMMENDATIONS', 'CATALOG_GAP']);
    const completions = recordsOf(records, 'finder_completed');
    assert.notEqual(completions[0].runId, completions[1].runId);
  });

  test('View and explanation identities include state, tool, and classification', () => {
    const { analytics, records } = setup();
    analytics.start();
    for (const method of ['recommendationViewed', 'explanationOpened']) {
      assert.equal(analytics[method](candidate(), 'RECOMMENDATIONS'), true);
      assert.equal(analytics[method](candidate(), 'RECOMMENDATIONS'), false);
      assert.equal(analytics[method](candidate('descript', 'TRY_FREE'), 'RECOMMENDATIONS'), true);
      assert.equal(analytics[method](candidate('elevenlabs', 'ADD'), 'RECOMMENDATIONS'), true);
      assert.equal(analytics[method](candidate(), 'REVIEW_OVERLAP'), true);
    }
    assert.equal(recordsOf(records, 'recommendation_viewed').length, 4);
    assert.equal(recordsOf(records, 'recommendation_explanation_opened').length, 4);
  });

  test('Reset starts a new run ordinal with fresh dedupe and sequence numbers', () => {
    const { analytics, records } = setup();
    const journey = () => {
      analytics.start();
      analytics.questionAnswered(1);
      analytics.completed('RECOMMENDATIONS');
      analytics.recommendationViewed(candidate(), 'RECOMMENDATIONS');
      analytics.explanationOpened(candidate(), 'RECOMMENDATIONS');
    };
    journey();
    const priorCount = records.length;
    analytics.reset();
    assert.equal(records.length, priorCount, 'Reset itself is not an analytics event');
    journey();
    const firstRun = records.slice(0, priorCount);
    const secondRun = records.slice(priorCount);
    assert.equal(secondRun[0].runId, firstRun[0].runId + 1);
    assert.deepEqual(secondRun.map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
    assert.deepEqual(secondRun.map(({ event, payload }) => ({ event, payload })), firstRun.map(({ event, payload }) => ({ event, payload })));
  });
});

describe('invalid arguments and sink isolation', () => {
  test('Invalid question numbers and states are dropped without throwing or consuming sequence', () => {
    const { analytics, records } = setup();
    analytics.start();
    for (const question of [0, 6, -1, 1.5, NaN, Infinity, '1', null, undefined, {}]) {
      assert.equal(analytics.questionAnswered(question), false);
    }
    for (const state of ['', 'BUY_NOTHING', 'conversion', 'person@example.invalid', null, undefined, 1, {}]) {
      assert.equal(analytics.completed(state), false);
      assert.equal(analytics.recommendationViewed(candidate(), state), false);
      assert.equal(analytics.explanationOpened(candidate(), state), false);
    }
    analytics.questionAnswered(1);
    assert.equal(records.length, 2);
    assert.equal(records[1].sequence, 2);
  });

  test('Malformed candidates and throwing required-field getters are safely dropped', () => {
    const { analytics, records } = setup();
    analytics.start();
    const throwingId = { get toolId() { throw new Error('No tool ID available'); }, status: 'ADD' };
    const throwingStatus = { toolId: 'descript', get status() { throw new Error('No status available'); } };
    const invalid = [null, undefined, [], 'descript', {}, { toolId: 'descript' }, { status: 'ADD' },
      candidate('descript', 'KEEP'), candidate('descript', 'REVIEW'), candidate('descript', 'TRY'),
      candidate('descript', 'conversion'), throwingId, throwingStatus];
    for (const value of invalid) {
      assert.equal(analytics.recommendationViewed(value, 'RECOMMENDATIONS'), false);
      assert.equal(analytics.explanationOpened(value, 'RECOMMENDATIONS'), false);
    }
    assert.equal(records.length, 1);
  });

  test('A throwing sink cannot interrupt the Finder lifecycle', () => {
    let attempts = 0;
    const analytics = createAnalytics({ emit() { attempts += 1; throw new Error('Sink unavailable'); } });
    assert.doesNotThrow(() => {
      analytics.start();
      analytics.questionAnswered(1);
      analytics.completed('RECOMMENDATIONS');
      analytics.recommendationViewed(candidate(), 'RECOMMENDATIONS');
      analytics.explanationOpened(candidate(), 'RECOMMENDATIONS');
      analytics.reset();
      analytics.start();
    });
    assert.equal(attempts, 6);
  });

  test('An absent sink remains a safe no-op in Node without browser globals', () => {
    const analytics = createAnalytics();
    assert.doesNotThrow(() => {
      analytics.start();
      analytics.questionAnswered(1);
      analytics.completed('CATALOG_GAP');
      analytics.recommendationViewed(candidate('writesonic', 'SKIP'), 'CATALOG_GAP');
      analytics.explanationOpened(candidate('writesonic', 'SKIP'), 'CATALOG_GAP');
      analytics.reset();
    });
  });

  test('Sink mutation attempts cannot change emitted payloads or engine decisions', () => {
    const input = { primaryJob: 'video', existingTools: [], frequency: 'daily', budget: 75, biggestPain: 'time' };
    const result = recommend(input);
    const before = structuredClone(result);
    const decisions = result.recommendations;
    const records = [];
    const analytics = createAnalytics({ emit(record) {
      records.push(record);
      assert.equal(Reflect.set(record, 'event', 'conversion'), false);
      assert.equal(Reflect.set(record.payload, 'classification', 'SKIP'), false);
      assert.equal(Reflect.set(record.payload, 'commissionRate', 100), false);
    } });
    analytics.start();
    analytics.completed(result.state);
    for (const decision of decisions) {
      analytics.recommendationViewed(decision, result.state);
      analytics.explanationOpened(decision, result.state);
    }
    assert.deepEqual(result, before);
    assert.deepEqual(recommend(input), before);
    assert.equal(recordsOf(records, 'recommendation_viewed')[0].payload.classification, 'ADD');
    assert.ok(records.every((record) => !Object.hasOwn(record.payload, 'commissionRate')));
  });
});

describe('affiliate click safeguards', () => {
  // Unit tests deliberately do not manufacture isTrusted:true. Actual positive
  // click proof requires browser interaction and is verified separately.
  test('There is no public method for fabricating an outbound or provider-fact event', () => {
    const { analytics } = setup();
    for (const name of ['emit', 'track', 'outboundAffiliateClick', 'conversion', 'signup', 'revenue', 'commission', 'payout']) {
      assert.equal(typeof analytics[name], 'undefined');
    }
  });

  test('Unsupported anchors and invalid configurations produce safe, repeatable cleanup functions', async () => {
    const { analytics, records } = setup();
    analytics.start();
    const config = { toolId: 'descript', status: 'ADD', state: 'RECOMMENDATIONS', buyNothing: false,
      approved: true, url: 'https://example.invalid/approved-referral' };
    for (const anchor of [null, undefined, {}, 'https://example.invalid', new EventTarget()]) {
      const cleanup = analytics.bindAffiliateClick(anchor, config);
      assert.equal(typeof cleanup, 'function');
      assert.doesNotThrow(() => { cleanup(); cleanup(); });
    }
    for (const badConfig of [null, undefined, {}, { ...config, approved: false }, { ...config, url: null },
      { ...config, url: 'javascript:alert(1)' }, { ...config, buyNothing: true },
      { ...config, status: 'SKIP' }, { ...config, status: 'OPTIONAL' },
      { ...config, state: 'CATALOG_GAP' }, { ...config, toolId: 'general-assistant' }]) {
      const cleanup = analytics.bindAffiliateClick(new EventTarget(), badConfig);
      assert.equal(typeof cleanup, 'function');
      assert.doesNotThrow(cleanup);
    }
    await nextTurn();
    assert.equal(recordsOf(records, 'outbound_affiliate_click').length, 0);
  });

  test('Synthetic Node events and anchor-shaped objects cannot create an outbound click', async () => {
    const { analytics, records } = setup();
    analytics.start();
    const target = new EventTarget();
    Object.assign(target, {
      tagName: 'A', isConnected: true, href: 'https://example.invalid/approved-referral',
      getAttribute: () => null, closest: () => null,
    });
    const cleanup = analytics.bindAffiliateClick(target, {
      toolId: 'descript', status: 'ADD', state: 'RECOMMENDATIONS', buyNothing: false,
      approved: true, url: target.href,
    });
    for (const type of ['click', 'auxclick', 'keydown']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      assert.equal(event.isTrusted, false);
      target.dispatchEvent(event);
    }
    await nextTurn();
    cleanup();
    assert.equal(recordsOf(records, 'outbound_affiliate_click').length, 0);
    assert.deepEqual(records.map(({ event }) => event), ['finder_started']);
  });
});

describe('recommendation independence', () => {
  test('Affiliate approval, referral availability, and economics cannot alter engine output', () => {
    const fields = ['affiliateStatus', 'referralUrl', 'commissionRate', 'cookieWindow', 'attributionWindow', 'payoutTerms'];
    const unavailable = CATALOG.map((tool) => ({ ...tool, affiliate: { approved: false, url: null },
      ...Object.fromEntries(fields.map((field) => [field, null])) }));
    const monetized = CATALOG.map((tool, index) => ({ ...tool,
      affiliate: { approved: true, url: `https://example.invalid/referral-${index}` },
      affiliateStatus: 'approved', referralUrl: `https://example.invalid/referral-${index}`,
      commissionRate: 1000 - index, cookieWindow: 30 * (index + 1), attributionWindow: 365, payoutTerms: 'Unlimited test payout',
    }));
    const unreadable = CATALOG.map((tool) => {
      const copy = { ...tool };
      for (const field of ['affiliate', ...fields]) Object.defineProperty(copy, field, {
        enumerable: true, get() { throw new Error(`Decision engine accessed ${field}`); },
      });
      return copy;
    });
    for (const primaryJob of ['general', 'video', 'voice', 'seo', 'coding', 'automation']) {
      const input = { primaryJob, existingTools: [], frequency: 'daily', budget: 150, biggestPain: 'time' };
      const baseline = recommend(input);
      assert.deepEqual(recommend(input, { catalog: unavailable }), baseline);
      assert.deepEqual(recommend(input, { catalog: monetized }), baseline);
      assert.deepEqual(recommend(input, { catalog: unreadable }), baseline);
    }
  });
});
