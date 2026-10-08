/**
 * Versioned decision fixtures for Issue #1, Milestones 3H/3I.
 * These values are inputs to the frozen acceptance model, not live price quotes.
 * The matrix supplies ElevenLabs' $6 and Writesonic's $99 exact-price cases;
 * Descript uses a $24 fixture consistent with the matrix's $25 paid-fit case.
 * Verify current plans and prices before adding a public pricing display.
 * Monetization metadata deliberately has no place in this module.
 */

export const JOBS = Object.freeze([
  'general', 'seo', 'video', 'voice', 'coding', 'automation',
]);

export const FREQUENCIES = Object.freeze([
  'occasional', 'monthly', 'weekly', 'daily',
]);

export const PAINS = Object.freeze([
  'cost', 'too_many_tools', 'time', 'quality', 'complexity', 'collaboration',
]);

export const GENERAL_ASSISTANT_IDS = Object.freeze([
  'chatgpt', 'claude', 'gemini', 'general-assistant',
]);

const specialist = (id, name, category, monthlyPrice, hasFreeTier, adjacentJob) => {
  const jobFit = Object.fromEntries(JOBS.map(job => [job, 0]));
  jobFit[category] = 20;
  // Related workflows remain below the revised relevance gate of 12.
  if (adjacentJob) jobFit[adjacentJob] = 8;
  return Object.freeze({
    id,
    name,
    category,
    monthlyPrice,
    hasFreeTier,
    jobFit: Object.freeze(jobFit),
    uniqueCapability: 3,
  });
};

export const CATALOG = Object.freeze([
  specialist('descript', 'Descript', 'video', 24, true, 'voice'),
  specialist('elevenlabs', 'ElevenLabs', 'voice', 6, true, 'video'),
  specialist('writesonic', 'Writesonic', 'seo', 99, false),
]);
