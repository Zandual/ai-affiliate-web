import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CATALOG } from '../catalog.mjs';
import { budgetFit, normalizeInput, recommend, scoreCandidate } from '../core.mjs';

// Frozen product outcomes: Issue #1, Milestone 3I, comment 6048474172.
// Raw historical scores are intentionally not assertions: Issue #2 freezes
// states, gates, and tool outcomes, while permitting explicit score calibration.
// Where a matrix row omits an input, use weekly / $75 / time / no existing tools,
// except the exact-budget A08/S08 rows, which retain an unspecified (neutral) pain.
const profile = (primaryJob, overrides = {}) => ({
  primaryJob,
  frequency: 'weekly',
  budget: 75,
  biggestPain: 'time',
  existingTools: [],
  ...overrides,
});

const FROZEN_SCENARIOS = [
  { id: 'G01', input: profile('general', { frequency: 'occasional', budget: 25, existingTools: ['chatgpt'] }), state: 'COVERED_BUY_NOTHING' },
  { id: 'G02', input: profile('general', { budget: 25 }), state: 'RECOMMEND_GENERIC_GENERAL', tool: ['general-assistant', 'TRY_FREE'] },
  { id: 'G03', input: profile('general', { frequency: 'daily', existingTools: ['chatgpt', 'claude'] }), state: 'REVIEW_OVERLAP' },
  { id: 'G04', input: profile('general', { budget: 150, existingTools: ['chatgpt', 'claude', 'gemini'] }), state: 'REVIEW_OVERLAP' },
  { id: 'G05', input: profile('general', { frequency: 'daily', budget: 0, existingTools: [{ toolId: 'chatgpt', monthlyCost: 0 }] }), state: 'COVERED_BUY_NOTHING' },
  { id: 'G06', input: profile('general', { frequency: 'occasional', budget: 0 }), state: 'RECOMMEND_GENERIC_GENERAL', tool: ['general-assistant', 'TRY_FREE'] },
  { id: 'G07', input: profile('general', { budget: 25, existingTools: [{ toolId: 'chatgpt', monthlyCost: null }] }), state: 'COVERED_BUY_NOTHING' },
  { id: 'G08', input: profile('general', { frequency: 'occasional', budget: 25, existingTools: ['chatgpt', 'elevenlabs'] }), state: 'COVERED_BUY_NOTHING' },
  { id: 'V01', input: profile('video'), state: 'RECOMMENDATIONS', tool: ['descript', 'ADD'] },
  { id: 'V02', input: profile('video', { frequency: 'daily', budget: 25 }), state: 'RECOMMENDATIONS', tool: ['descript', 'ADD'] },
  { id: 'V03', input: profile('video', { frequency: 'daily', budget: 10, biggestPain: 'cost' }), state: 'RECOMMENDATIONS', tool: ['descript', 'TRY_FREE'] },
  { id: 'V04', input: profile('video', { frequency: 'monthly', biggestPain: 'cost' }), state: 'RECOMMENDATIONS', tool: ['descript', 'TRY_FREE'] },
  { id: 'V05', input: profile('video', { frequency: 'occasional', budget: 100, biggestPain: 'quality' }), state: 'RECOMMENDATIONS', tool: ['descript', 'TRY_FREE'] },
  { id: 'V06', input: profile('video', { existingTools: ['descript'] }), state: 'COVERED_KEEP_EXISTING', tool: ['descript', 'KEEP'] },
  { id: 'V07', input: profile('video', { existingTools: ['elevenlabs'] }), state: 'RECOMMENDATIONS', tool: ['descript', 'ADD'] },
  { id: 'V08', input: profile('video', { frequency: 'daily', budget: 150, biggestPain: 'quality' }), state: 'RECOMMENDATIONS', tool: ['descript', 'ADD'] },
  { id: 'A01', input: profile('voice', { frequency: 'daily', biggestPain: 'quality' }), state: 'RECOMMENDATIONS', tool: ['elevenlabs', 'ADD'] },
  { id: 'A02', input: profile('voice', { budget: 25 }), state: 'RECOMMENDATIONS', tool: ['elevenlabs', 'ADD'] },
  { id: 'A03', input: profile('voice', { frequency: 'monthly', budget: 25, biggestPain: 'quality' }), state: 'RECOMMENDATIONS', tool: ['elevenlabs', 'TRY_FREE'] },
  { id: 'A04', input: profile('voice', { frequency: 'occasional', budget: 0, biggestPain: 'cost' }), state: 'RECOMMENDATIONS', tool: ['elevenlabs', 'TRY_FREE'] },
  { id: 'A05', input: profile('voice', { existingTools: ['elevenlabs'] }), state: 'COVERED_KEEP_EXISTING', tool: ['elevenlabs', 'KEEP'] },
  { id: 'A06', input: profile('voice', { frequency: 'daily', budget: 5 }), state: 'RECOMMENDATIONS', tool: ['elevenlabs', 'TRY_FREE'] },
  { id: 'A07', input: profile('voice', { frequency: 'daily', budget: 150, existingTools: ['descript'] }), state: 'RECOMMENDATIONS', tool: ['elevenlabs', 'ADD'] },
  { id: 'A08', input: profile('voice', { budget: 6, biggestPain: null }), state: 'RECOMMENDATIONS', tool: ['elevenlabs', 'TRY_FREE'] },
  { id: 'S01', input: profile('seo', { frequency: 'daily', budget: 200 }), state: 'RECOMMENDATIONS', tool: ['writesonic', 'ADD'] },
  { id: 'S02', input: profile('seo', { budget: 150, biggestPain: 'quality' }), state: 'RECOMMENDATIONS', tool: ['writesonic', 'ADD'] },
  { id: 'S03', input: profile('seo', { biggestPain: 'cost' }), state: 'BUDGET_CONSTRAINT', tool: ['writesonic', 'SKIP'] },
  { id: 'S04', input: profile('seo', { frequency: 'daily', budget: 25 }), state: 'BUDGET_CONSTRAINT', tool: ['writesonic', 'SKIP'] },
  { id: 'S05', input: profile('seo', { frequency: 'monthly', budget: 500 }), state: 'NO_STRONG_RECOMMENDATION', tool: ['writesonic', 'OPTIONAL'] },
  { id: 'S06', input: profile('seo', { frequency: 'occasional', budget: 500, biggestPain: 'quality' }), state: 'NO_STRONG_RECOMMENDATION', tool: ['writesonic', 'SKIP'] },
  { id: 'S07', input: profile('seo', { budget: 200, existingTools: ['writesonic'] }), state: 'COVERED_KEEP_EXISTING', tool: ['writesonic', 'KEEP'] },
  { id: 'S08', input: profile('seo', { budget: 99, biggestPain: null }), state: 'NO_STRONG_RECOMMENDATION', tool: ['writesonic', 'OPTIONAL'] },
  { id: 'C01', input: profile('coding', { frequency: 'daily', budget: 150 }), state: 'CATALOG_GAP' },
  { id: 'C02', input: profile('coding', { budget: 0 }), state: 'CATALOG_GAP' },
  { id: 'O01', input: profile('automation', { frequency: 'daily', budget: 150 }), state: 'CATALOG_GAP' },
  { id: 'O02', input: profile('automation', { frequency: 'monthly', budget: 25 }), state: 'CATALOG_GAP' },
];

const JOBS = ['general', 'seo', 'video', 'voice', 'coding', 'automation'];
const FREQUENCIES = ['occasional', 'monthly', 'weekly', 'daily'];
const PAINS = ['cost', 'too_many_tools', 'time', 'quality', 'complexity', 'collaboration'];
const BUDGETS = [0, 5, 6, 10, 25, 75, 99, 150, 200, 500];
const SPECIALISTS = ['descript', 'elevenlabs', 'writesonic'];
const catalogTool = (toolId) => {
  const tool = CATALOG.find(({ id }) => id === toolId);
  assert.ok(tool, `Missing catalog fixture: ${toolId}`);
  return tool;
};
const recommendation = (result, toolId) => {
  const item = result.recommendations.find((entry) => entry.toolId === toolId);
  assert.ok(item, `Missing new-tool result: ${toolId}`);
  return item;
};

function* inputGrid() {
  for (const primaryJob of JOBS) {
    for (const frequency of FREQUENCIES) {
      for (const budget of BUDGETS) {
        for (const biggestPain of PAINS) {
          yield profile(primaryJob, { frequency, budget, biggestPain });
        }
      }
    }
  }
}

describe('frozen scenarios (36)', () => {
  for (const fixture of FROZEN_SCENARIOS) {
    test(`${fixture.id}: ${fixture.state}${fixture.tool ? ` / ${fixture.tool.join(' → ')}` : ''}`, () => {
      const result = recommend(fixture.input);
      assert.equal(result.state, fixture.state);
      if (fixture.tool) {
        const [toolId, status] = fixture.tool;
        const source = status === 'KEEP' ? result.audit : result.recommendations;
        assert.equal(source.find((item) => item.toolId === toolId)?.status, status);
      }
      if (fixture.state === 'CATALOG_GAP' || fixture.state === 'BUDGET_CONSTRAINT') {
        assert.equal(result.buyNothing, false, `${fixture.state} must remain distinct from buy-nothing`);
      }
      if (fixture.state === 'COVERED_BUY_NOTHING') assert.equal(result.buyNothing, true);
      if (fixture.state === 'REVIEW_OVERLAP') {
        const assistants = result.audit.filter((item) => ['chatgpt', 'claude', 'gemini'].includes(item.toolId));
        assert.equal(assistants.length, fixture.input.existingTools.length);
        assert.ok(assistants.every((item) => item.status === 'REVIEW_OVERLAP'), 'Every assistant gets equal review treatment');
      }
      if (fixture.input.primaryJob === 'general') {
        assert.ok(result.recommendations.filter((item) => SPECIALISTS.includes(item.toolId)).every((item) => item.status === 'SKIP'));
      }
      if (fixture.input.primaryJob === 'video' || fixture.input.primaryJob === 'voice') {
        const primaryTool = fixture.input.primaryJob === 'video' ? 'descript' : 'elevenlabs';
        assert.ok(result.recommendations.filter((item) => SPECIALISTS.includes(item.toolId) && item.toolId !== primaryTool).every((item) => item.status === 'SKIP'), 'Adjacent or unrelated specialists must not surface in v1');
      }
    });
  }
});

describe('trust invariants (6)', () => {
  test('1. Irrelevant specialists never get ADD, even when cheap and used daily', () => {
    for (const input of inputGrid()) {
      for (const item of recommend(input).recommendations) {
        if (item.scoreBreakdown.jobFit < 12) assert.equal(item.status, 'SKIP', `${JSON.stringify(input)}: ${item.toolId}`);
      }
    }
    const source = catalogTool('descript');
    for (const jobFit of [0, 7, 11]) {
      const irrelevant = { ...source, monthlyPrice: 0, hasFreeTier: true, jobFit: { ...source.jobFit, seo: jobFit } };
      assert.equal(scoreCandidate(irrelevant, normalizeInput(profile('seo', { frequency: 'daily', budget: 500 }))).status, 'SKIP');
    }
  });

  test('2. Affiliate metadata cannot affect ranking, score, or classification and is never read', () => {
    const metadataFields = ['affiliate', 'affiliateUrl', 'commission', 'programStatus', 'affiliateCommission',
      'affiliateStatus', 'referralUrl', 'commissionRate', 'attributionWindow', 'payoutTerms'];
    const monetized = CATALOG.map((tool, index) => ({
      ...tool,
      affiliate: { approved: true, url: `https://example.invalid/referral-${index}`, commission: 100000 - index },
      affiliateUrl: `https://example.invalid/${index}`,
      commission: 100000 - index,
      programStatus: 'approved',
      affiliateStatus: 'active',
      referralUrl: `https://example.invalid/referral-${index}`,
      commissionRate: 1 - index / 100,
      attributionWindow: 365,
      payoutTerms: 'Test metadata must never influence a decision',
    }));
    const unavailable = CATALOG.map((tool) => ({
      ...tool,
      ...Object.fromEntries(metadataFields.map((key) => [key, null])),
    }));
    const unreadable = CATALOG.map((tool) => {
      const copy = { ...tool };
      for (const key of metadataFields) {
        Object.defineProperty(copy, key, { enumerable: true, get() { throw new Error(`Scoring read forbidden field: ${key}`); } });
      }
      return copy;
    });
    for (const { input } of FROZEN_SCENARIOS) {
      const baseline = recommend(input);
      assert.deepEqual(recommend(input, { catalog: monetized }), baseline);
      assert.deepEqual(recommend(input, { catalog: unavailable }), baseline);
      assert.deepEqual(recommend(input, { catalog: unreadable }), baseline);
    }
    const voice = normalizeInput(profile('voice', { frequency: 'daily' }));
    assert.deepEqual(scoreCandidate(unreadable.find((tool) => tool.id === 'elevenlabs'), voice), scoreCandidate(catalogTool('elevenlabs'), voice));
  });

  test('3. A paid ADD never exceeds the stated total budget', () => {
    for (const input of inputGrid()) {
      const result = recommend(input);
      for (const item of result.recommendations.filter((entry) => entry.status === 'ADD')) {
        assert.ok(catalogTool(item.toolId).monthlyPrice <= input.budget, `${item.toolId} exceeds ${input.budget}`);
      }
      assert.ok(result.cost.recommendedNewMonthly <= input.budget, 'Combined recommended new spend must fit the total budget');
    }
  });

  test('4. Existing primary specialists suppress duplicate upselling', () => {
    for (const [primaryJob, toolId] of [['video', 'descript'], ['voice', 'elevenlabs'], ['seo', 'writesonic']]) {
      for (const frequency of FREQUENCIES) {
        for (const budget of BUDGETS) {
          const result = recommend(profile(primaryJob, { frequency, budget, existingTools: [toolId] }));
          assert.equal(result.state, 'COVERED_KEEP_EXISTING');
          assert.equal(result.audit.find((item) => item.toolId === toolId)?.status, 'KEEP');
          assert.ok(result.recommendations.every((item) => item.toolId !== toolId), 'An owned tool is not a new candidate');
          assert.ok(result.recommendations.every((item) => !['ADD', 'TRY_FREE'].includes(item.status)), 'Coverage must not trigger an adjacent upsell');
          assert.equal(result.cost.recommendedNewMonthly, 0);
        }
      }
    }
  });

  test('5. Catalog gaps never become buy-nothing', () => {
    for (const primaryJob of ['coding', 'automation']) {
      for (const frequency of FREQUENCIES) {
        for (const budget of BUDGETS) {
          for (const existingTools of [[], ['chatgpt'], ['chatgpt', 'claude'], ['descript', 'elevenlabs', 'writesonic']]) {
            const result = recommend(profile(primaryJob, { frequency, budget, existingTools }));
            assert.equal(result.state, 'CATALOG_GAP');
            assert.equal(result.buyNothing, false);
            assert.ok(result.recommendations.every((item) => !['ADD', 'TRY_FREE'].includes(item.status)));
          }
        }
      }
    }
  });

  test('6. Buy-nothing results contain no purchasable recommendation state', () => {
    let buyNothingResults = 0;
    const inputs = [...inputGrid(), ...FROZEN_SCENARIOS.map(({ input }) => input)];
    for (const input of inputs) {
      const result = recommend(input);
      if (!result.buyNothing) continue;
      buyNothingResults += 1;
      assert.ok(result.recommendations.every((item) => !['ADD', 'TRY_FREE', 'OPTIONAL'].includes(item.status)), `${JSON.stringify(input)} has a purchasable recommendation`);
      assert.equal(result.cost.recommendedNewMonthly, 0);
    }
    assert.ok(buyNothingResults > 0, 'The invariant must exercise real buy-nothing results');
  });
});

describe('input, hard gates, and deterministic explanations', () => {
  test('Multiple primary candidates cannot commit combined new spend above budget', () => {
    const source = catalogTool('descript');
    const catalog = [source, { ...source, id: 'second-video' }, { ...source, id: 'third-video', hasFreeTier: false }];
    const input = profile('video', { frequency: 'daily', budget: 25 });
    const result = recommend(input, { catalog });
    assert.equal(result.cost.recommendedNewMonthly, 24);
    assert.equal(recommendation(result, 'descript').status, 'ADD');
    assert.equal(recommendation(result, 'second-video').status, 'TRY_FREE');
    assert.equal(recommendation(result, 'third-video').status, 'OPTIONAL');
    assert.equal(recommendation(result, 'second-video').override, 'COMBINED_BUDGET');
    assert.deepEqual(recommend(input, { catalog: [...catalog].reverse() }), result);
  });

  test('The fixture manifest contains exactly the 36 frozen IDs', () => {
    const expected = ['G', 'V', 'A', 'S'].flatMap((prefix) => Array.from({ length: 8 }, (_, index) => `${prefix}0${index + 1}`)).concat(['C01', 'C02', 'O01', 'O02']);
    assert.equal(FROZEN_SCENARIOS.length, 36);
    assert.deepEqual(FROZEN_SCENARIOS.map(({ id }) => id).sort(), expected.sort());
    assert.equal(new Set(FROZEN_SCENARIOS.map(({ id }) => id)).size, 36);
  });

  test('Budget bands use finite ceilings and conservatively use 150 for the open-ended band', () => {
    for (const [budget, ceiling] of [['0-25', 25], ['26-75', 75], ['76-150', 150], ['150+', 150]]) {
      for (const primaryJob of JOBS) {
        const banded = recommend(profile(primaryJob, { budget }));
        const exact = recommend(profile(primaryJob, { budget: ceiling }));
        assert.equal(banded.state, exact.state);
        assert.deepEqual(banded.recommendations, exact.recommendations);
        assert.deepEqual(banded.cost, exact.cost);
      }
    }
  });

  test('Missing optional answers use explicit defaults and nonpositive budget behaves as zero', () => {
    assert.deepEqual(recommend({ primaryJob: 'voice', frequency: 'weekly', budget: 25 }), recommend(profile('voice', { budget: 25, biggestPain: null })));
    assert.deepEqual(recommend(profile('voice', { budget: -10 })), recommend(profile('voice', { budget: 0 })));
  });

  test('Invalid required values are rejected instead of silently recommending a tool', () => {
    for (const primaryJob of ['', 'sales', null, undefined]) assert.throws(() => normalizeInput(profile(primaryJob)));
    for (const frequency of ['', 'hourly', null, undefined]) assert.throws(() => normalizeInput(profile('video', { frequency })));
    for (const budget of [NaN, Infinity, -Infinity, '', 'cheap', null, undefined]) assert.throws(() => normalizeInput(profile('video', { budget })));
  });

  test('Invalid optional costs, tool identifiers, and duplicate entries are rejected', () => {
    for (const monthlyCost of [-1, NaN, Infinity, -Infinity, '20', {}, true]) {
      assert.throws(() => normalizeInput(profile('general', { existingTools: [{ toolId: 'chatgpt', monthlyCost }] })), TypeError);
    }
    for (const toolId of ['', ' ', ' chatgpt', 'chatgpt ', null, 42]) {
      assert.throws(() => normalizeInput(profile('general', { existingTools: [{ toolId }] })), TypeError);
    }
    for (const existingTools of [null, {}, 'chatgpt', [null], ['chatgpt', { toolId: 'chatgpt', monthlyCost: 20 }]]) {
      assert.throws(() => normalizeInput(profile('general', { existingTools })), TypeError);
    }
    assert.throws(() => normalizeInput(profile('general', { biggestPain: 'earn_commission' })), TypeError);
  });

  test('Malformed catalog prices and job-fit values fail before producing recommendations', () => {
    const source = catalogTool('descript');
    const input = profile('video');
    for (const monthlyPrice of [-1, NaN, Infinity, -Infinity, '24', null, undefined]) {
      const invalid = { ...source, monthlyPrice };
      assert.throws(() => recommend(input, { catalog: [invalid] }), TypeError);
      assert.throws(() => scoreCandidate(invalid, normalizeInput(input)), TypeError);
    }
    for (const video of [-1, 21, NaN, Infinity, '20', null, undefined]) {
      const invalid = { ...source, jobFit: { ...source.jobFit, video } };
      assert.throws(() => recommend(input, { catalog: [invalid] }), TypeError);
      assert.throws(() => scoreCandidate(invalid, normalizeInput(input)), TypeError);
    }
    for (const jobFit of [null, [], 'video']) {
      assert.throws(() => recommend(input, { catalog: [{ ...source, jobFit }] }), TypeError);
    }
    assert.throws(() => recommend(input, { catalog: [source, { ...source }] }), TypeError);
  });

  test('Budget-fit boundaries retain their explicit inclusive thresholds', () => {
    for (const [price, budget, expected] of [
      [0, 0, 6], [0, 100, 6], [1, 0, -10],
      [25, 100, 6], [25.01, 100, 4],
      [50, 100, 4], [50.01, 100, 1],
      [75, 100, 1], [75.01, 100, -4],
      [100, 100, -4], [100.01, 100, -10],
    ]) {
      assert.equal(budgetFit(price, budget), expected, `price ${price}, budget ${budget}`);
    }
    for (const invalid of [-1, NaN, Infinity, '25', null]) {
      assert.throws(() => budgetFit(invalid, 100), TypeError);
      assert.throws(() => budgetFit(25, invalid), TypeError);
    }
  });

  test('Equal-score candidates use stable identifier ordering independent of catalog order', () => {
    const source = catalogTool('descript');
    const tiedCatalog = [{ ...source, id: 'zeta-video' }, { ...source, id: 'alpha-video' }];
    const input = profile('video');
    const result = recommend(input, { catalog: tiedCatalog });
    assert.deepEqual(result.recommendations.map(({ toolId }) => toolId), ['alpha-video', 'zeta-video']);
    assert.equal(result.recommendations[0].score, result.recommendations[1].score);
    assert.equal(result.recommendations[0].status, result.recommendations[1].status);
    assert.deepEqual(recommend(input, { catalog: [...tiedCatalog].reverse() }), result);
  });

  test('Occasional and monthly usage never produce a paid ADD', () => {
    for (const primaryJob of ['video', 'voice', 'seo']) {
      for (const frequency of ['occasional', 'monthly']) {
        for (const biggestPain of PAINS) {
          const result = recommend(profile(primaryJob, { frequency, budget: 500, biggestPain }));
          assert.ok(result.recommendations.every((item) => item.status !== 'ADD'));
          const writesonic = recommendation(result, 'writesonic');
          if (primaryJob === 'seo') assert.equal(writesonic.status, frequency === 'monthly' ? 'OPTIONAL' : 'SKIP');
        }
      }
    }
  });

  test('Over-budget non-free tools skip while relevant free tiers remain free trials', () => {
    const seo = recommend(profile('seo', { frequency: 'daily', budget: 98 }));
    assert.equal(seo.state, 'BUDGET_CONSTRAINT');
    assert.equal(seo.buyNothing, false);
    assert.equal(recommendation(seo, 'writesonic').status, 'SKIP');
    for (const [primaryJob, toolId] of [['video', 'descript'], ['voice', 'elevenlabs']]) {
      const result = recommend(profile(primaryJob, { frequency: 'daily', budget: 0 }));
      assert.equal(recommendation(result, toolId).status, 'TRY_FREE');
      assert.equal(result.cost.recommendedNewMonthly, 0);
    }
  });

  test('Generic baseline is satisfied by any existing general-assistant brand', () => {
    for (const toolId of ['chatgpt', 'claude', 'gemini']) {
      const result = recommend(profile('general', { existingTools: [toolId] }));
      assert.equal(result.state, 'COVERED_BUY_NOTHING');
      assert.equal(result.audit.find((item) => item.toolId === toolId)?.status, 'KEEP');
      assert.ok(result.recommendations.every((item) => !['ADD', 'TRY_FREE'].includes(item.status)));
    }
  });

  test('Results are deterministic, explain their decisions, and do not mutate inputs or catalog', () => {
    const catalogBefore = structuredClone(CATALOG);
    for (const { input } of FROZEN_SCENARIOS) {
      const inputBefore = structuredClone(input);
      const result = recommend(input);
      assert.deepEqual(recommend(input), result);
      assert.deepEqual(input, inputBefore);
      assert.equal(new Set(result.recommendations.map(({ toolId }) => toolId)).size, result.recommendations.length);
      for (const item of [...result.audit, ...result.recommendations]) {
        assert.ok(Array.isArray(item.reasons) && item.reasons.length > 0, `${item.toolId} must explain ${item.status}`);
        assert.ok(item.reasons.every((reason) => typeof reason === 'string' && reason.trim().length > 0));
      }
      for (const item of result.recommendations) {
        assert.ok(Number.isFinite(item.score));
        for (const part of ['jobFit', 'frequencyFit', 'budgetFit', 'uniqueCapability', 'overlapPenalty']) assert.ok(Number.isFinite(item.scoreBreakdown[part]), `${item.toolId}: missing finite ${part}`);
        assert.ok(Object.hasOwn(item, 'override'));
        assert.ok(Array.isArray(item.hardGates));
      }
    }
    assert.deepEqual(CATALOG, catalogBefore);
  });
});

describe('cost provenance and overlap audit', () => {
  test('Known entered costs, including zero, are preserved without catalog-price substitution', () => {
    const result = recommend(profile('general', { existingTools: [{ toolId: 'chatgpt', monthlyCost: 0 }, { toolId: 'descript', monthlyCost: 42.5 }] }));
    assert.equal(result.cost.currentUserEnteredMonthly, 42.5);
    assert.equal(result.cost.currentEstimatedMonthly, 42.5);
    assert.equal(result.cost.currentKnownMonthly, 42.5);
    assert.equal(result.audit.find((item) => item.toolId === 'chatgpt')?.monthlyCost, 0);
    assert.equal(result.audit.find((item) => item.toolId === 'descript')?.monthlyCost, 42.5);
    assert.equal(result.cost.recommendedEstimatedMonthly, 42.5);
  });

  test('Unknown subscription costs leave totals unknown and preserve only the entered subtotal', () => {
    const result = recommend(profile('general', { existingTools: [{ toolId: 'chatgpt', monthlyCost: 17 }, 'descript'] }));
    assert.equal(result.cost.currentUserEnteredMonthly, null);
    assert.equal(result.cost.currentEstimatedMonthly, null);
    assert.equal(result.cost.currentKnownMonthly, 17);
    assert.equal(result.cost.recommendedEstimatedMonthly, null);
    assert.equal(result.audit.find((item) => item.toolId === 'descript')?.monthlyCost, null);
    assert.equal(result.cost.estimatedSavingsMonthly, null);
  });

  test('Overlap review never selects an arbitrary winner or claims cancellation savings', () => {
    const existingTools = [{ toolId: 'chatgpt', monthlyCost: 20 }, { toolId: 'claude', monthlyCost: 25 }, { toolId: 'gemini', monthlyCost: 0 }];
    const result = recommend(profile('general', { existingTools }));
    assert.equal(result.state, 'REVIEW_OVERLAP');
    assert.ok(result.audit.every((item) => item.status === 'REVIEW_OVERLAP'));
    assert.equal(result.cost.overlapReviewMonthly, 45);
    assert.equal(result.cost.currentUserEnteredMonthly, 45);
    assert.equal(result.cost.recommendedEstimatedMonthly, 45);
    assert.equal(result.cost.estimatedSavingsMonthly, null);
    const reversed = recommend(profile('general', { existingTools: [...existingTools].reverse() }));
    assert.equal(reversed.state, result.state);
    assert.deepEqual(reversed.cost, result.cost);
    assert.ok(reversed.audit.every((item) => item.status === 'REVIEW_OVERLAP'));
  });

  test('Unknown overlapping subscriptions do not create fabricated review totals', () => {
    const result = recommend(profile('general', { existingTools: [{ toolId: 'chatgpt', monthlyCost: 20 }, 'claude'] }));
    assert.equal(result.cost.overlapReviewMonthly, null);
    assert.equal(result.cost.estimatedSavingsMonthly, null);
  });

  test('New spend counts only paid ADD; trials and optional products add no committed spend', () => {
    const added = recommend(profile('video', { existingTools: [{ toolId: 'chatgpt', monthlyCost: 20 }] }));
    assert.equal(added.cost.recommendedNewMonthly, catalogTool('descript').monthlyPrice);
    assert.equal(added.cost.recommendedEstimatedMonthly, 20 + catalogTool('descript').monthlyPrice);
    for (const input of [profile('voice', { budget: 0 }), profile('seo', { frequency: 'monthly', budget: 500 })]) {
      const result = recommend(input);
      assert.equal(result.cost.currentUserEnteredMonthly, 0);
      assert.equal(result.cost.recommendedNewMonthly, 0);
      assert.equal(result.cost.recommendedEstimatedMonthly, 0);
      assert.equal(result.cost.estimatedSavingsMonthly, null);
    }
  });
});
