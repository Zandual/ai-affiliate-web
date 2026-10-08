import { CATALOG, JOBS, FREQUENCIES, PAINS } from './catalog.mjs';
import { auditExistingTools } from './audit.mjs';

const BUDGET_BANDS = Object.freeze({ '0-25': 25, '26-75': 75, '76-150': 150, '150+': 150 });
const FREQUENCY_POINTS = Object.freeze({ occasional: 0, monthly: 2, weekly: 4, daily: 6 });
const PURCHASE_STATES = new Set(['ADD', 'TRY_FREE', 'OPTIONAL']);
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const STATUS_ORDER = Object.freeze({ ADD: 0, TRY_FREE: 1, OPTIONAL: 2, SKIP: 3 });
const compareRecommendations = (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  || b.score - a.score || compareIds(a.toolId, b.toolId);

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function number(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

/** Normalize only decision inputs. Missing prices remain unknown; no implicit numeric coercion. */
export function normalizeInput(input) {
  record(input, 'input');
  const { primaryJob, frequency, budget, biggestPain = null, existingTools = [] } = input;
  if (!JOBS.includes(primaryJob)) throw new TypeError('Invalid primaryJob');
  if (!FREQUENCIES.includes(frequency)) throw new TypeError('Invalid frequency');
  if (biggestPain !== null && !PAINS.includes(biggestPain)) throw new TypeError('Invalid biggestPain');
  const isBand = typeof budget === 'string' && Object.hasOwn(BUDGET_BANDS, budget);
  const normalizedBudget = isBand ? BUDGET_BANDS[budget]
    : Math.max(0, number(budget, 'budget', -Number.MAX_SAFE_INTEGER));
  if (!Array.isArray(existingTools)) throw new TypeError('existingTools must be an array');
  const seen = new Set();
  const normalizedTools = existingTools.map(tool => {
    if (typeof tool !== 'string') record(tool, 'existing tool');
    const toolId = typeof tool === 'string' ? tool : tool.toolId;
    if (typeof toolId !== 'string' || !toolId.trim() || toolId !== toolId.trim()) {
      throw new TypeError('Existing tool requires a nonempty toolId without surrounding whitespace');
    }
    if (seen.has(toolId)) throw new TypeError(`Duplicate existing tool: ${toolId}`);
    seen.add(toolId);
    const monthlyCost = typeof tool === 'string' ? null : tool.monthlyCost ?? null;
    if (monthlyCost !== null) number(monthlyCost, 'monthlyCost');
    return { toolId, monthlyCost };
  }).sort((a, b) => compareIds(a.toolId, b.toolId));
  return {
    primaryJob,
    frequency,
    budget: normalizedBudget,
    budgetBand: isBand ? budget : null,
    // The open-ended band has no ceiling. Use its floor conservatively.
    budgetBasis: budget === '150+' ? 'band-lower-bound' : isBand ? 'band-ceiling' : 'exact',
    biggestPain,
    existingTools: normalizedTools,
  };
}

/**
 * This allowlist is the trust boundary. Never spread/serialize an incoming tool:
 * the scorer receives a fresh decision-only object, without monetization fields.
 */
function decisionTool(raw) {
  record(raw, 'catalog tool');
  const { id, name, category, monthlyPrice, hasFreeTier, jobFit, uniqueCapability } = raw;
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Invalid catalog tool id');
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('Invalid catalog tool name');
  if (!JOBS.includes(category)) throw new TypeError('Invalid catalog tool category');
  number(monthlyPrice, 'monthlyPrice');
  if (typeof hasFreeTier !== 'boolean') throw new TypeError('hasFreeTier must be boolean');
  record(jobFit, 'jobFit');
  const fits = Object.fromEntries(JOBS.map(job => [job, number(jobFit[job], `jobFit.${job}`, 0, 20)]));
  return { id, name, category, monthlyPrice, hasFreeTier, jobFit: fits,
    uniqueCapability: number(uniqueCapability, 'uniqueCapability', 0, 3) };
}

/**
 * Graduated budget points reproduce the 3I fixture examples. They are score
 * components, NOT a new hard budget-share rule. In particular V02 scores 27
 * (daily + time), while A08/S08 score 23 (weekly, no stated pain modifier).
 * Keep those frozen outcomes; do not add a universal >50%/exact-budget veto.
 * Source: https://github.com/Zandual/ai-affiliate-web/issues/1#issuecomment-6048474172
 */
export function budgetFit(monthlyPrice, budget) {
  number(monthlyPrice, 'monthlyPrice');
  number(budget, 'budget');
  if (monthlyPrice === 0) return 6;
  if (budget <= 0 || monthlyPrice > budget) return -10;
  const share = monthlyPrice / budget;
  if (share <= 0.25) return 6;
  if (share <= 0.5) return 4;
  if (share <= 0.75) return 1;
  return -4;
}

function scoreDecisionTool(tool, input, coverage) {
  const existing = input.existingTools.some(owned => owned.toolId === tool.id);
  const samePrimaryCategory = coverage.hasPrimarySpecialist && tool.category === input.primaryJob;
  const scoreBreakdown = {
    jobFit: tool.jobFit[input.primaryJob],
    frequencyFit: FREQUENCY_POINTS[input.frequency],
    budgetFit: budgetFit(tool.monthlyPrice, input.budget),
    uniqueCapability: tool.uniqueCapability,
    overlapPenalty: samePrimaryCategory ? -9 : 0,
    problemModifier: ['time', 'quality'].includes(input.biggestPain) ? 2 : 0,
  };
  const score = Object.values(scoreBreakdown).reduce((sum, points) => sum + points, 0);
  const hardGates = [];
  const { jobFit } = scoreBreakdown;
  if (existing) hardGates.push('EXISTING_TOOL');
  if (jobFit < 12) hardGates.push('INSUFFICIENT_JOB_FIT');
  if (coverage.hasPrimarySpecialist) hardGates.push('PRIMARY_ALREADY_COVERED');
  if (tool.monthlyPrice > input.budget) hardGates.push('OVER_BUDGET');
  if (input.budget <= 0 && tool.monthlyPrice > 0) hardGates.push('NO_PAID_BUDGET');
  if (input.frequency === 'occasional') hardGates.push('OCCASIONAL_USE');
  if (input.frequency === 'monthly') hardGates.push('MONTHLY_USE');

  let status;
  let override = null;
  let reason;
  const decide = (nextStatus, gate, explanation) => {
    status = nextStatus;
    override = gate;
    reason = explanation;
  };
  if (existing) {
    decide('KEEP', 'EXISTING_TOOL', 'Audit the tool you already own instead of purchasing it again.');
  } else if (jobFit < 12) {
    decide('SKIP', 'INSUFFICIENT_JOB_FIT', 'This specialist does not closely fit your primary job.');
  } else if (coverage.hasPrimarySpecialist) {
    // No explicit secondary capability gap exists in the v1 questionnaire.
    decide('SKIP', 'PRIMARY_ALREADY_COVERED', 'Your existing specialist covers this job; no additional purchase is justified.');
  } else if (tool.monthlyPrice > input.budget) {
    decide(tool.hasFreeTier && jobFit >= 18 ? 'TRY_FREE' : 'SKIP', 'OVER_BUDGET',
      tool.hasFreeTier && jobFit >= 18
        ? 'Start with the free tier; the paid plan exceeds your stated budget.'
        : 'The paid plan exceeds your stated budget.');
  } else if (input.frequency === 'occasional') {
    decide(tool.hasFreeTier && jobFit >= 18 ? 'TRY_FREE' : 'SKIP', 'OCCASIONAL_USE',
      'Occasional use does not justify a paid specialist; use a relevant free tier where available.');
  } else if (input.frequency === 'monthly') {
    decide(tool.hasFreeTier && jobFit >= 18 ? 'TRY_FREE' : score >= 10 ? 'OPTIONAL' : 'SKIP',
      'MONTHLY_USE', 'Monthly use does not justify a paid ADD; prove recurring value first.');
  } else if (score >= 25) {
    decide('ADD', null, 'Recurring use, job fit, and the stated budget justify this specialist.');
  } else if (score >= 18 && tool.hasFreeTier && jobFit >= 18) {
    decide('TRY_FREE', null, 'Try the free tier before committing to another paid subscription.');
  } else {
    decide(score >= 10 ? 'OPTIONAL' : 'SKIP', null, 'The fit does not justify a confident paid recommendation.');
  }
  return {
    toolId: tool.id,
    name: tool.name,
    status,
    score,
    scoreBreakdown,
    monthlyPrice: tool.monthlyPrice,
    hasFreeTier: tool.hasFreeTier,
    reasons: [reason],
    override,
    hardGates,
  };
}

/** Score one candidate with the same normalization, audit, and hard gates as recommend(). */
export function scoreCandidate(candidate, input) {
  const normalized = normalizeInput(input);
  return scoreDecisionTool(decisionTool(candidate), normalized, auditExistingTools(normalized));
}

function genericAssistant() {
  return {
    toolId: 'general-assistant',
    name: 'One general AI assistant',
    status: 'TRY_FREE',
    score: 20,
    scoreBreakdown: { jobFit: 20, frequencyFit: 0, budgetFit: 0, uniqueCapability: 0, overlapPenalty: 0, problemModifier: 0 },
    monthlyPrice: 0,
    hasFreeTier: true,
    reasons: ['Start with one general-purpose assistant on a free tier; choose the one that suits your work.'],
    override: 'GENERAL_FREE_FIRST',
    hardGates: ['GENERAL_FREE_FIRST'],
  };
}

/** Pure v1 recommendation entry point. No browser, network, storage, clock, or affiliate dependency. */
export function recommend(input, { catalog = CATALOG } = {}) {
  const normalized = normalizeInput(input);
  if (!Array.isArray(catalog)) throw new TypeError('catalog must be an array');
  const decisionCatalog = catalog.map(decisionTool);
  if (new Set(decisionCatalog.map(tool => tool.id)).size !== decisionCatalog.length) {
    throw new TypeError('Duplicate catalog tool id');
  }
  const coverage = auditExistingTools(normalized);
  const existingIds = new Set(normalized.existingTools.map(tool => tool.toolId));
  const recommendations = decisionCatalog
    .filter(tool => !existingIds.has(tool.id))
    .map(tool => scoreDecisionTool(tool, normalized, coverage))
    .sort(compareRecommendations);

  // The frozen catalog has one primary specialist per job. If a supplied
  // decision catalog has more, their combined new paid spend must still fit.
  let remainingBudget = normalized.budget;
  for (const candidate of recommendations) {
    if (candidate.status !== 'ADD') continue;
    if (candidate.monthlyPrice <= remainingBudget) {
      remainingBudget -= candidate.monthlyPrice;
    } else {
      candidate.status = candidate.hasFreeTier && candidate.scoreBreakdown.jobFit >= 18
        ? 'TRY_FREE' : 'OPTIONAL';
      candidate.override = 'COMBINED_BUDGET';
      candidate.hardGates.push('COMBINED_BUDGET');
      candidate.reasons = ['Adding this paid plan as well would exceed your total budget; do not commit to it alongside the higher-ranked addition.'];
    }
  }

  let state;
  // Coding/automation remain explicitly unvetted in v1, even with an injected catalog.
  if (['coding', 'automation'].includes(normalized.primaryJob)) {
    state = 'CATALOG_GAP';
  } else if (coverage.hasGeneralOverlap) {
    state = 'REVIEW_OVERLAP';
  } else if (normalized.primaryJob === 'general') {
    state = coverage.hasGeneralAssistant ? 'COVERED_BUY_NOTHING' : 'RECOMMEND_GENERIC_GENERAL';
  } else if (coverage.hasPrimarySpecialist) {
    state = 'COVERED_KEEP_EXISTING';
  } else if (!decisionCatalog.some(tool => tool.jobFit[normalized.primaryJob] >= 18)) {
    state = 'CATALOG_GAP';
  } else if (recommendations.some(tool => ['ADD', 'TRY_FREE'].includes(tool.status))) {
    state = 'RECOMMENDATIONS';
  } else if (decisionCatalog.some(tool => tool.jobFit[normalized.primaryJob] >= 18
    && tool.monthlyPrice > normalized.budget)) {
    state = 'BUDGET_CONSTRAINT';
  } else {
    state = 'NO_STRONG_RECOMMENDATION';
  }

  const buyNothing = ['COVERED_BUY_NOTHING', 'COVERED_KEEP_EXISTING'].includes(state);
  // Aggregate trust states are also a gate, including for externally supplied catalogs.
  if (buyNothing || state === 'CATALOG_GAP' || normalized.primaryJob === 'general') {
    for (const candidate of recommendations) {
      if (PURCHASE_STATES.has(candidate.status)) {
        candidate.status = 'SKIP';
        candidate.override = state;
        candidate.hardGates.push(state);
        candidate.reasons = [state === 'CATALOG_GAP'
          ? 'There is no vetted v1 recommendation for this job.'
          : 'No additional specialist is justified for this job.'];
      }
    }
  }
  if (state === 'RECOMMEND_GENERIC_GENERAL') recommendations.push(genericAssistant());
  recommendations.sort(compareRecommendations);
  const recommendedNewMonthly = recommendations.reduce((total, tool) =>
    total + (tool.status === 'ADD' ? tool.monthlyPrice : 0), 0);
  return {
    state,
    buyNothing,
    input: normalized,
    audit: coverage.audit,
    recommendations,
    cost: {
      ...coverage.cost,
      recommendedNewMonthly,
      recommendedEstimatedMonthly: coverage.cost.currentEstimatedMonthly === null
        ? null : coverage.cost.currentEstimatedMonthly + recommendedNewMonthly,
    },
  };
}
