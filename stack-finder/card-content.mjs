// Presentation only: never used by the decision engine or affiliate eligibility.
// Provider descriptions and limitations were checked on 2026-11-11; sources and
// unresolved offer details are in OFFER-REVIEW.md. Fixed amounts remain fixtures.
const PROFILES = {
  descript: {
    purpose: 'Edit video and podcast recordings by editing their transcript.',
    focus: 'video and podcast editing',
    limit: 'Free access has usage and feature limits. Its AI-credit allowance is one-time; media time renews monthly. Hobbyist is a separate paid plan. Check current media, AI-feature, and export limits.',
  },
  elevenlabs: {
    purpose: 'Generate spoken audio from text for narration and voiceovers.',
    focus: 'voiceovers and narration',
    limit: 'Audio made on the free plan is not licensed for commercial use and requires attribution. Starter is a separate paid plan. Check paid-plan rights before creating business or client audio.',
  },
  writesonic: {
    purpose: 'Track visibility in AI search, audit SEO, and research and draft articles for search-focused content workflows.',
    focus: 'search-focused content',
    limit: 'A limited free trial is not an ongoing free plan. Starter is paid. Check current trial terms and plan features before subscribing. Review generated content before publishing.',
  },
  'general-assistant': {
    purpose: 'Help with everyday writing, research, and questions.',
    focus: 'general work',
    limit: 'Check the chosen assistant\'s current free-access limits and terms. Review its answers before relying on them.',
  },
};
const JOB_LABELS = {
  general: 'general work', video: 'video and podcast editing', voice: 'voice and audio work',
  seo: 'search-focused content', coding: 'coding', automation: 'automation and operations',
};
const ACTIONS = {
  ADD: ['ADD - Paid option', 'Check current plan pricing and included features, then test it on a real task before subscribing.'],
  TRY_FREE: ['TRY FREE - Evaluate first', 'Evaluate a small task with free access first. Paid plans are separate; check the limits below before using the result.'],
  OPTIONAL: ['OPTIONAL - No purchase suggested', 'Hold off on a paid subscription until a recurring need makes its value clear.'],
  SKIP: ['SKIP - Not recommended', 'Do not add this tool based on these answers.'],
};
const money = value => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(value);

function reason(tool, input, profile) {
  const job = JOB_LABELS[input.primaryJob] ?? 'your selected job';
  // Explain the engine's existing gate; do not recalculate or replace a decision.
  switch (tool.override) {
    case 'INSUFFICIENT_JOB_FIT':
      return `You chose ${job}. This tool focuses on ${profile.focus}, so it is not a close match for that need.`;
    case 'OVER_BUDGET':
      return `Its paid comparison amount is above the amount remaining after your existing monthly costs.${tool.status === 'TRY_FREE' ? ' Only a free evaluation is suggested.' : ' No paid addition is suggested.'}`;
    case 'COMBINED_BUDGET':
      return 'The combined paid comparison amounts would exceed your budget. Do not commit to this alongside the higher-ranked addition.';
    case 'OCCASIONAL_USE':
      return 'You expect to use it only occasionally, so another paid subscription is not justified.';
    case 'MONTHLY_USE':
      return 'Monthly use does not yet justify a paid subscription. Establish a recurring need before paying.';
    default:
      if (tool.status === 'ADD') {
        return `You chose ${job} with ${input.frequency} use. This tool matches that job, and its comparison amount fits the amount remaining after your entered existing monthly costs.`;
      }
      return tool.reasons.join(' ');
  }
}

export function describeDecision(tool, input) {
  const profile = PROFILES[tool.toolId] ?? {
    purpose: 'Check this tool\'s capabilities against your task.', focus: 'a different workflow',
    limit: 'Verify current features, pricing, and usage rights before committing.',
  };
  const [statusLabel, action] = ACTIONS[tool.status] ?? [tool.status, 'Review this decision before making a change.'];
  return {
    purpose: profile.purpose,
    statusLabel,
    action,
    whyLabel: tool.status === 'SKIP' ? 'Why skip it' : 'Why this action',
    why: reason(tool, input, profile),
    price: tool.toolId === 'general-assistant'
      ? 'No paid addition suggested. Check the chosen assistant\'s current free access.'
      : `Paid comparison amount: ${money(tool.monthlyPrice)} / month - not a current price quote.`,
    limit: profile.limit,
  };
}
