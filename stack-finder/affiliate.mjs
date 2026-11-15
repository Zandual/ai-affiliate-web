// Presentation-only policy. Never import this module into scoring or catalog code.
// Owner-supplied dashboard link; no redirect request was made during preparation.
export const ELEVENLABS_URL = 'https://try.elevenlabs.io/av5dvh9hjnf6';
export const DEFAULT_AFFILIATE_POLICY = Object.freeze({ enabled: false, url: ELEVENLABS_URL });
export const AFFILIATE_DISCLOSURE = 'SilentForge is an independent ElevenLabs affiliate and may earn a commission if you subscribe through this link.';
export const AFFILIATE_RELATIONSHIP = 'SilentForge is an independent ElevenLabs affiliate and may earn a commission from qualifying referrals. This does not affect your recommendation.';
export const EXTERNAL_NOTICE = 'Opens ElevenLabs, an external site using referral tracking. Your optional Finder analytics choice does not control tracking on that site. Check its current plans and terms; no purchase is made here.';
export const TRADEMARK_ATTRIBUTION = 'ElevenLabs and the ElevenLabs logo are registered trademarks or trademarks of ElevenLabs, Inc. Used with permission. SilentForge is not sponsored by, endorsed by, or affiliated with ElevenLabs except as an independent participant in the ElevenLabs Creator Affiliate Program.';

export function affiliateEnabled(policy = DEFAULT_AFFILIATE_POLICY) {
  return policy?.enabled === true && policy.url === ELEVENLABS_URL;
}

export function affiliateAction(tool, result, policy = DEFAULT_AFFILIATE_POLICY, existing = false) {
  if (!affiliateEnabled(policy) || existing || tool?.toolId !== 'elevenlabs'
    || result?.buyNothing !== false || !['RECOMMENDATIONS', 'REVIEW_OVERLAP'].includes(result.state)
    || !['ADD', 'TRY_FREE'].includes(tool.status)) return null;
  return Object.freeze({ url: ELEVENLABS_URL,
    label: tool.status === 'TRY_FREE' ? 'Explore free evaluation options' : 'Explore ElevenLabs plans',
    disclosure: AFFILIATE_DISCLOSURE, externalNotice: EXTERNAL_NOTICE });
}
