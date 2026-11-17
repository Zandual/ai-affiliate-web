import { recommend } from './core.mjs';
import { createAnalytics } from './analytics.mjs';
import { describeDecision } from './card-content.mjs';
import { createConsentAnalytics } from './consent.mjs';
import { DEFAULT_AFFILIATE_POLICY, affiliateEnabled, affiliateAction, AFFILIATE_RELATIONSHIP, TRADEMARK_ATTRIBUTION } from './affiliate.mjs';

// Presentation labels only. All coverage, ranking, and classification come from core.mjs.
const JOBS = [
  ['general', 'General work', 'Writing, research, and everyday questions'],
  ['seo', 'SEO / content', 'Search-focused content and publishing'],
  ['video', 'Video / podcast', 'Editing recordings and producing episodes'],
  ['voice', 'Voice / audio', 'Voiceovers, narration, and dubbing'],
  ['coding', 'Coding', 'Building and maintaining software'],
  ['automation', 'Automation / operations', 'Connecting tools and repeatable tasks'],
];
const TOOLS = [
  ['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini'],
  ['general-assistant', 'Another general AI assistant'],
  ['descript', 'Descript'], ['elevenlabs', 'ElevenLabs'], ['writesonic', 'Writesonic'],
  ['other', 'Another tool'],
];
const FREQUENCIES = [
  ['occasional', 'Occasionally', 'A one-off task or now and then'],
  ['monthly', 'Monthly', 'A few tasks each month'],
  ['weekly', 'Weekly', 'Part of my weekly workflow'],
  ['daily', 'Daily', 'I rely on this most days'],
];
const BUDGETS = [
  ['0-25', '$0–25', 'Uses $25 for the comparison'],
  ['26-75', '$26–75', 'Uses $75 for the comparison'],
  ['76-150', '$76–150', 'Uses $150 for the comparison'],
  ['150+', '$150+', 'Uses $150 conservatively; enter an exact amount if needed'],
  ['exact', 'Enter an exact budget', 'Including $0 if you only want free options'],
];
const PAINS = [
  ['cost', 'Costs too much'], ['too_many_tools', 'Too many tools'],
  ['time', 'Takes too much time'], ['quality', 'Output quality'],
  ['complexity', 'Too complicated'], ['collaboration', 'Collaboration / handoff'],
];
const QUESTIONS = [
  ['primaryJob', 'What do you most need AI to do?', 'Choose your main job. We will focus on that need.', JOBS],
  ['existingTools', 'What is already in your stack?', 'Select every tool you use, including free plans. Monthly costs are optional: leave a cost blank if you do not know it.', TOOLS],
  ['frequency', 'How often will you use it?', 'Think about the job you selected, rather than AI in general.', FREQUENCIES],
  ['budget', 'What is your total monthly AI budget?', 'Include all your AI software. Amounts are in USD per month.', BUDGETS],
  ['biggestPain', 'What is your biggest problem?', 'Choose the one improvement that would matter most.', PAINS],
];
const STATES = {
  COVERED_BUY_NOTHING: ['Buy nothing', 'Your current stack covers this job.', 'You probably do not need another AI subscription right now. Keep using what you have and revisit when your needs change.'],
  COVERED_KEEP_EXISTING: ['Keep your existing specialist', 'You already have the tool for this job.', 'Your specialist covers your primary need. Keep it in your stack; another related subscription is not justified.'],
  REVIEW_OVERLAP: ['Review overlap', 'Give each subscription a clear role.', 'Your general assistants may overlap. Keep the one you actually use or prefer, and review the others. We have not picked a winner or assumed any cancellation savings.'],
  RECOMMENDATIONS: ['Your lean AI stack', 'Here is what earns a closer look.', 'These recommendations reflect your job, usage, and budget. Start with the suggested action for each tool.'],
  RECOMMEND_GENERIC_GENERAL: ['Start free', 'Start with one general AI assistant.', 'Try a free tier and choose the assistant that fits your everyday work. You do not need a specialist subscription to get started.'],
  BUDGET_CONSTRAINT: ['Budget constraint', 'A relevant tool is outside your budget.', 'A vetted paid capability exists, but it does not fit your stated budget. This does not mean your current stack covers the need.'],
  NO_STRONG_RECOMMENDATION: ['No strong recommendation', 'A paid addition has not earned its place.', 'Relevant tools exist, but the current frequency and value do not justify a confident paid addition. Optional means worth considering, not a recommendation to buy.'],
  CATALOG_GAP: ['Catalog gap', 'No confident recommendation yet.', 'Our catalog does not yet include a vetted specialist for this job. This is a gap in our coverage, not a claim that you need nothing.'],
};
const toolNames = Object.fromEntries(TOOLS);
const money = value => value === null ? 'Unknown' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(value);
const labelFor = (options, value) => options.find(option => option[0] === value)?.[1] ?? value;

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false && value !== null && value !== undefined) node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined));
  return node;
}

export function mountStackFinder(root, { affiliatePolicy = DEFAULT_AFFILIATE_POLICY } = {}) {
  // Snapshot the local policy; no query parameter or browser storage can activate it.
  affiliatePolicy = Object.freeze({ enabled: affiliateEnabled(affiliatePolicy), url: DEFAULT_AFFILIATE_POLICY.url });
  let stopOutbound = () => {};
  const view = root.ownerDocument.defaultView;
  const explainMode = new URLSearchParams(view.location.search).get('sf_explain') === '1';
  const consent = createConsentAnalytics({ target: root, view });
  const analytics = createAnalytics({
    emit: detail => {
      if (consent.isAllowed()) root.dispatchEvent(new view.CustomEvent('stack-finder:analytics', { detail, bubbles: true }));
    },
  });
  let stopViewing = () => {};
  let step = -1;
  let answers;
  let result = null;
  const reset = () => {
    stopViewing();
    analytics.reset();
    answers = { primaryJob: null, existingTools: new Set(), nothing: false, costs: {}, frequency: null, budget: null, exactBudget: '', biggestPain: null };
    result = null;
    step = -1;
  };
  reset();

  function button(text, action, secondary = false) {
    const node = element('button', { type: 'button', class: `sf-button${secondary ? ' sf-button--secondary' : ''}` }, text);
    node.addEventListener('click', action);
    return node;
  }

  function privacyControls() {
    const status = element('p', { class: 'sf-help', role: 'status' });
    const toggle = button('', () => {
      const enabled = consent.isAllowed();
      const accepted = enabled ? (consent.decline(), true) : consent.allow();
      update(accepted);
    }, true);
    function update(available = true) {
      const enabled = consent.isAllowed();
      status.textContent = !available ? 'Optional analytics is unavailable. You can still use the Finder.'
        : enabled ? 'Optional analytics is allowed for this page.' : 'Optional analytics is off.';
      toggle.textContent = enabled ? 'Turn analytics off' : 'Turn analytics on';
    }
    update();
    return element('div', { class: 'sf-privacy-controls' }, status, toggle);
  }

  function startFinder(allowAnalytics) {
    if (allowAnalytics) consent.allow();
    else consent.decline();
    analytics.start();
    step = 0;
    render();
  }
  function shell(content) {
    stopOutbound();
    stopOutbound = () => {};
    stopViewing();
    stopViewing = () => {};
    root.replaceChildren(element('div', { class: 'sf-shell' },
      element('header', {}, element('span', { class: 'sf-brand' }, 'AI Stack Finder'),
        element('span', { class: 'sf-meta' }, 'Fewer tools. More purpose.')),
      content,
      element('footer', { class: 'sf-footer' },
        element('p', {}, 'Your questionnaire selections and amounts are processed in this page and clear when you restart or reload. Only if you allow optional analytics, we send limited usage events, including result categories and recommended tools, to PostHog in the United States to improve the Finder.'),
        privacyControls(),
        element('details', { class: 'sf-privacy' },
          element('summary', {}, 'Privacy and analytics'),
          element('p', {}, 'AI Stack Finder is operated by SilentForge. For privacy questions or requests, email ',
            element('a', { href: 'mailto:silentforgelive@gmail.com' }, 'silentforgelive@gmail.com'), '.'),
          element('p', {}, 'Usage events tell us when the Finder starts, which question numbers are completed, the result category, which recommendation cards or explanations are viewed, and eligible outbound affiliate-link activations. They include page-local run and sequence numbers, a random ID created only after you allow analytics, replaced after you turn it off and on, and only recognized campaign labels from the page link. These categories can reveal something about your needs, even though we do not send your individual answers, selected existing tools, entered costs, exact budget, name, or email.'),
          element('p', {}, 'This Finder analytics integration uses no cookies or browser storage, does not record your screen, and does not create a personal profile. It instructs PostHog not to store your IP address or add an IP-derived location to these events. Our hosting and analytics providers still receive network information needed to deliver requests.'),
          element('p', {}, 'If you allow analytics, usage events are stored in our PostHog project. Its event retention is set to one year. PostHog removes expired events in batches, so some events may remain longer until cleanup.'),
          element('p', {}, 'Your choice is kept only in this page: reloading turns analytics off again. Turning analytics off stops future collection and cancels pending requests, but cannot retract requests already received. Restarting or reloading clears your questionnaire answers but does not delete usage events already sent. If analytics is blocked or unavailable, the Finder still works.')),
        element('p', {}, 'Affiliate availability does not affect recommendations. ', affiliateEnabled(affiliatePolicy) ? 'Eligible ElevenLabs recommendations may include an affiliate link.' : 'No affiliate links are active.'),
        element('p', { class: 'sf-trademark' }, TRADEMARK_ATTRIBUTION))));
  }

  function focusTitle() {
    const title = root.querySelector('.sf-title');
    title?.focus({ preventScroll: true });
    title?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  function render(focus = true) {
    if (step < 0) renderIntro();
    else if (step < QUESTIONS.length) renderQuestion();
    else renderResults();
    if (focus) focusTitle();
  }

  function renderIntro() {
    shell(element('div', { class: 'sf-intro' },
      element('p', { class: 'sf-eyebrow' }, 'A little clarity for your next subscription'),
      element('h2', { class: 'sf-title', tabindex: '-1' }, 'Build a smaller AI stack.'),
      element('p', { class: 'sf-lead' }, 'Pay only for what earns its place. Answer five quick questions to see what to keep, what to try, and what to skip. We may recommend that you buy nothing.'),
      element('div', { class: 'sf-principles' },
        [['01 · Your work first', 'One primary job, with recommendations that fit.'],
          ['02 · Keep what works', 'Review what you already use before adding more.'],
          ['03 · Respect your budget', 'A free tier—or no new purchase—may be the right next step.']]
          .map(([title, description]) => element('div', {}, element('strong', {}, title), element('p', {}, description)))),
      element('section', { class: 'sf-consent', 'aria-labelledby': 'sf-consent-title' },
        element('h3', { id: 'sf-consent-title' }, 'Help improve the Finder?'),
        element('p', {}, 'Optional analytics shares limited usage events with PostHog in the United States. Your questionnaire answers, entered costs, and exact budget are not sent. Your recommendations are the same either way.'),
        element('div', { class: 'sf-consent-actions' },
          button('Allow optional analytics', () => startFinder(true), true),
          button('Continue without analytics', () => startFinder(false), true)),
        element('p', { class: 'sf-help' }, 'Both choices start the Finder. You can change your choice below at any time.')),
      element('p', { class: 'sf-help' }, 'About 60–90 seconds · No account needed')));
  }

  function choice(type, name, value, title, description, checked) {
    const input = element('input', { type, name, value, checked });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.click();
      }
    });
    return element('label', { class: 'sf-option' }, input,
      element('span', { class: 'sf-option-copy' }, element('strong', {}, title), description ? element('small', {}, description) : null));
  }

  function numericInput(id, label, value, placeholder) {
    const input = element('input', { class: 'sf-cost-input', id, type: 'number', inputmode: 'decimal', min: '0', max: String(Number.MAX_SAFE_INTEGER), step: '0.01', placeholder });
    input.value = value;
    return element('div', { class: 'sf-cost' }, element('label', { for: id }, label), input);
  }

  function renderQuestion() {
    const [key, title, help, options] = QUESTIONS[step];
    const progressText = `Question ${step + 1} of 5`;
    const grid = element('div', { class: 'sf-options' });
    const form = element('form', { class: 'sf-form', novalidate: true });
    const error = element('p', { id: 'sf-error', class: 'sf-error', role: 'alert' });
    const next = element('button', { type: 'submit', class: 'sf-button' }, step === 4 ? 'See my stack' : 'Next');
    const validNumber = input => input.checkValidity() && (input.value === '' || (Number.isFinite(Number(input.value)) && Number(input.value) >= 0));

    function refresh() {
      let answered = Boolean(answers[key]);
      let valid = true;
      if (key === 'existingTools') {
        answered = answers.nothing || answers.existingTools.size > 0;
        grid.querySelectorAll('input[type="checkbox"]').forEach(input => {
          input.checked = input.value === 'nothing' ? answers.nothing : answers.existingTools.has(input.value);
        });
        grid.querySelectorAll('[data-cost-for]').forEach(container => {
          const selected = answers.existingTools.has(container.dataset.costFor);
          container.hidden = !selected;
          const input = container.querySelector('input');
          input.disabled = !selected;
          const invalid = selected && !validNumber(input);
          input.setAttribute('aria-invalid', String(invalid));
          valid = valid && !invalid;
        });
      } else if (key === 'budget') {
        const container = form.querySelector('[data-exact-budget]');
        const input = container.querySelector('input');
        container.hidden = answers.budget !== 'exact';
        input.disabled = answers.budget !== 'exact';
        if (answers.budget === 'exact') {
          answered = input.value !== '';
          valid = validNumber(input);
        }
        input.setAttribute('aria-invalid', String(!valid));
      }
      error.textContent = valid ? '' : 'Enter a valid monthly amount of $0 or more, with at most two decimal places.';
      next.disabled = !answered || !valid;
      return answered && valid;
    }

    if (key === 'existingTools') {
      for (const [id, name] of options) {
        const option = choice('checkbox', key, id, name, null, answers.existingTools.has(id));
        const cost = numericInput(`sf-cost-${id}`, `${name} monthly cost (USD, optional)`, answers.costs[id] ?? '', 'Unknown');
        cost.dataset.costFor = id;
        const input = cost.querySelector('input');
        input.setAttribute('aria-describedby', 'sf-help sf-error');
        input.addEventListener('input', () => { answers.costs[id] = input.value; refresh(); });
        option.querySelector('input').addEventListener('change', event => {
          if (event.target.checked) { answers.existingTools.add(id); answers.nothing = false; }
          else answers.existingTools.delete(id);
          refresh();
        });
        grid.append(element('div', { class: 'sf-tool-row' }, option, cost));
      }
      const nothing = choice('checkbox', key, 'nothing', 'Nothing', 'I do not currently use any AI tools', answers.nothing);
      nothing.querySelector('input').addEventListener('change', event => {
        answers.nothing = event.target.checked;
        if (answers.nothing) {
          answers.existingTools.clear();
          answers.costs = {};
          grid.querySelectorAll('input[type="number"]').forEach(input => { input.value = ''; });
        }
        refresh();
      });
      grid.append(nothing);
    } else {
      for (const [value, label, description] of options) {
        const option = choice('radio', key, value, label, description, answers[key] === value);
        option.querySelector('input').addEventListener('change', () => { answers[key] = value; refresh(); });
        grid.append(option);
      }
    }

    const fieldset = element('fieldset', { class: 'sf-fieldset', 'aria-describedby': 'sf-help' },
      element('legend', { class: 'sf-title', tabindex: '-1' }, title), element('p', { id: 'sf-help', class: 'sf-help' }, help), grid);
    if (key === 'budget') {
      const exact = numericInput('sf-exact-budget', 'Exact monthly budget (USD)', answers.exactBudget, 'For example, 0 or 50');
      exact.dataset.exactBudget = '';
      exact.querySelector('input').addEventListener('input', event => { answers.exactBudget = event.target.value; refresh(); });
      exact.querySelector('input').setAttribute('aria-describedby', 'sf-error');
      fieldset.append(exact);
    }
    form.append(fieldset, error, element('div', { class: 'sf-actions' },
      button('Back', () => { step -= 1; render(); }, true), next));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!refresh()) return;
      if (step === 4) {
        try {
          result = recommend({
            primaryJob: answers.primaryJob,
            existingTools: [...answers.existingTools].map(toolId => ({ toolId,
              monthlyCost: (answers.costs[toolId] ?? '') === '' ? null : Number(answers.costs[toolId]) })),
            frequency: answers.frequency,
            budget: answers.budget === 'exact' ? Number(answers.exactBudget) : answers.budget,
            biggestPain: answers.biggestPain,
          });
        } catch {
          error.textContent = 'We could not build your stack. Go back and check your answers and monthly amounts.';
          return;
        }
      }
      analytics.questionAnswered(step + 1);
      if (step === 4) analytics.completed(result.state);
      step += 1;
      render();
    });
    shell(element('div', {},
      element('div', { class: 'sf-progress' }, element('span', { role: 'status' }, progressText),
        element('progress', { max: '5', value: String(step + 1), 'aria-label': progressText })), form));
    refresh();
  }

  function toolCard(tool, existing = false) {
    const content = existing ? null : describeDecision(tool, result.input);
    const price = existing
      ? tool.monthlyCost === null ? 'Monthly cost unknown' : `${money(tool.monthlyCost)} / month · entered by you`
      : content.price;
    const outbound = affiliateAction(tool, result, affiliatePolicy, existing);
    // Disclosure remains visible for ElevenLabs mentions even while links are off.
    return element('article', { class: 'sf-tool-card', 'data-tool-id': tool.toolId },
      element('header', {}, element('h3', { class: 'sf-tool-name' }, tool.name ?? toolNames[tool.toolId] ?? tool.toolId),
        element('span', { class: 'sf-status', 'data-status': tool.status }, content?.statusLabel ?? tool.status.replaceAll('_', ' '))),
      content ? element('p', { class: 'sf-purpose' }, content.purpose) : null,
      content ? element('p', { class: 'sf-action' }, element('strong', {}, 'Next step: '), content.action) : null,
      content ? element('p', { class: 'sf-reason' }, element('strong', {}, `${content.whyLabel}: `), content.why) : null,
      element('p', { class: 'sf-price' }, price),
      content ? element('p', { class: 'sf-limit' }, element('strong', {}, 'Before you use it: '), content.limit)
        : tool.reasons.map(reason => element('p', { class: 'sf-reason' }, reason)),
      tool.toolId === 'elevenlabs' ? element('div', { class: 'sf-affiliate' },
        element('p', { class: 'sf-affiliate-disclosure' }, outbound?.disclosure ?? AFFILIATE_RELATIONSHIP),
        outbound ? element('p', { class: 'sf-external-notice' }, outbound.externalNotice) : null,
        outbound ? element('a', { class: 'sf-button sf-affiliate-link', href: outbound.url, target: '_blank', rel: 'sponsored noopener noreferrer', referrerpolicy: 'no-referrer' }, outbound.label) : null) : null,
      explainMode && !existing ? explanation(tool) : null);
  }

  function explanation(tool) {
    const resultState = result.state;
    const fields = element('dl');
    for (const [label, value] of [
      ['Job fit', tool.scoreBreakdown.jobFit],
      ['Frequency fit', tool.scoreBreakdown.frequencyFit],
      ['Budget fit', tool.scoreBreakdown.budgetFit],
      ['Unique capability', tool.scoreBreakdown.uniqueCapability],
      ['Overlap penalty', tool.scoreBreakdown.overlapPenalty],
      ['Problem modifier', tool.scoreBreakdown.problemModifier],
      ['Score total', tool.score],
      ['Hard gates triggered', tool.hardGates.length ? tool.hardGates.join(', ') : 'None'],
      ['Final classification', tool.status],
    ]) fields.append(element('div', {}, element('dt', {}, label), element('dd', {}, String(value))));
    const details = element('details', { class: 'sf-explain' },
      element('summary', {}, `Explain recommendation: ${tool.name}`), fields);
    // toggle represents an opened panel, rather than a click on an already-open one.
    details.addEventListener('toggle', () => {
      if (details.open && details.isConnected) analytics.explanationOpened(tool, resultState);
    });
    return details;
  }

  function observeRecommendations() {
    if (!view.IntersectionObserver) return;
    const displayedResult = result;
    const visibleCards = new Set();
    const cards = new Map([...root.querySelectorAll('[data-recommendations] .sf-tool-card')]
      .map((card, index) => [card, displayedResult.recommendations[index]]));
    let active = true;
    const emitVisible = () => {
      if (!active || result !== displayedResult || root.ownerDocument.visibilityState !== 'visible') return;
      for (const card of visibleCards) {
        if (card.isConnected) analytics.recommendationViewed(cards.get(card), displayedResult.state);
      }
    };
    const observer = new view.IntersectionObserver(entries => {
      if (!active) return;
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.25) visibleCards.add(entry.target);
        else visibleCards.delete(entry.target);
      }
      emitVisible();
    }, { threshold: 0.25 });
    for (const card of cards.keys()) observer.observe(card);
    root.ownerDocument.addEventListener('visibilitychange', emitVisible);
    stopViewing = () => {
      active = false;
      observer.disconnect();
      visibleCards.clear();
      root.ownerDocument.removeEventListener('visibilitychange', emitVisible);
    };
  }

  function renderResults() {
    const [label, title, description] = result.state === 'BUDGET_CONSTRAINT' && result.cost.availableForNewMonthly === null
      ? ['Budget not yet known', 'Check your existing monthly costs.', 'Some existing costs are unknown. Enter every cost before considering a paid addition; we cannot establish whether it fits your total budget.']
      : STATES[result.state];
    const spend = (name, value) => element('div', {}, element('dt', {}, name), element('dd', {}, money(value)));
    const content = element('div', { class: 'sf-results', 'data-state': result.state, 'data-buy-nothing': String(result.buyNothing) },
      element('div', { class: 'sf-result-summary' }, element('span', { class: 'sf-state-label' }, label),
        element('h2', { class: 'sf-title', tabindex: '-1' }, title), element('p', { class: 'sf-lead' }, description)),
      element('dl', { class: 'sf-spend' },
        spend('Current monthly spend · entered by you', result.cost.currentUserEnteredMonthly),
        spend('Budget remaining after existing costs', result.cost.availableForNewMonthly),
        spend('New paid spend in this comparison', result.cost.recommendedNewMonthly),
        spend('Estimated total with paid additions', result.cost.recommendedEstimatedMonthly),
        spend('Monthly spend to review for overlap', result.cost.overlapReviewMonthly)),
      element('p', { class: 'sf-note' }, result.cost.currentUserEnteredMonthly === null
        ? `Known entered subtotal: ${money(result.cost.currentKnownMonthly)}. Other subscription costs are unknown, so your total and remaining budget are unknown. Enter every existing cost before considering paid additions.`
        : 'Current spend uses only the amounts you entered. Overlap review does not imply guaranteed savings.'),
      element('p', { class: 'sf-note' }, 'New-spend figures use fixed comparison amounts, not current provider prices. Free evaluations and optional tools add no paid commitment here. Taxes or usage charges may increase actual costs. Check current pricing, limits, and usage rights before choosing a plan.'));
    if (result.audit.length) content.append(element('h3', { class: 'sf-section-title' }, 'Your existing tools'),
      element('div', { class: 'sf-card-grid', 'data-audit': '' }, result.audit.map(tool => toolCard(tool, true))));
    content.append(element('h3', { class: 'sf-section-title' }, 'New-tool decisions'),
      element('p', { class: 'sf-note sf-decisions-note' }, 'Follow each card’s action. SKIP means we do not recommend adding that tool based on your answers.'),
      element('div', { class: 'sf-card-grid', 'data-recommendations': '' }, result.recommendations.map(tool => toolCard(tool))));
    if (explainMode) content.append(element('p', { class: 'sf-note sf-explain-note' },
      'Development explain mode: open a recommendation to inspect the values and hard gates returned by the engine.'));
    const summary = element('dl');
    for (const [name, value] of [
      ['Primary job', labelFor(JOBS, answers.primaryJob)],
      ['Existing tools', answers.nothing ? 'Nothing' : [...answers.existingTools].map(id => toolNames[id]).join(', ')],
      ['Usage', labelFor(FREQUENCIES, answers.frequency)],
      ['Total monthly budget', answers.budget === 'exact' ? money(result.input.budget) : labelFor(BUDGETS, answers.budget)],
      ['Biggest problem', labelFor(PAINS, answers.biggestPain)],
    ]) summary.append(element('dt', {}, name), element('dd', {}, value));
    content.append(element('details', { class: 'sf-answer-summary' }, element('summary', {}, 'Your answers'), summary),
      element('div', { class: 'sf-actions' }, button('Back to answers', () => { result = null; step = 4; render(); }, true),
        button('Start over', () => { reset(); render(); })));
    shell(content);
    const unbind = [];
    for (const anchor of root.querySelectorAll('[data-recommendations] .sf-affiliate-link')) {
      const tool = result.recommendations.find(item => item.toolId === anchor.closest('[data-tool-id]').dataset.toolId);
      const action = affiliateAction(tool, result, affiliatePolicy);
      if (action) unbind.push(analytics.bindAffiliateClick(anchor, { toolId: tool.toolId, status: tool.status, state: result.state, buyNothing: result.buyNothing, approved: true, url: action.url }));
    }
    stopOutbound = () => unbind.forEach(stop => stop());
    observeRecommendations();
  }

  render(false);
}

const root = document.getElementById('stack-finder');
if (root) mountStackFinder(root);
