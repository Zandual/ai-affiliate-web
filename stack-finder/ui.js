import { recommend } from './core.mjs';

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

export function mountStackFinder(root) {
  let step = -1;
  let answers;
  let result = null;
  const reset = () => {
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

  function shell(content) {
    root.replaceChildren(element('div', { class: 'sf-shell' },
      element('header', {}, element('span', { class: 'sf-brand' }, 'AI Stack Finder'),
        element('span', { class: 'sf-meta' }, 'Fewer tools. More purpose.')),
      content,
      element('p', { class: 'sf-footer' }, 'Your answers stay in this page and clear when you restart or reload. Affiliate availability does not affect recommendations. No affiliate links are active.')));
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
      button('Find my stack', () => { step = 0; render(); }),
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
      step += 1;
      render();
    });
    shell(element('div', {},
      element('div', { class: 'sf-progress' }, element('span', { role: 'status' }, progressText),
        element('progress', { max: '5', value: String(step + 1), 'aria-label': progressText })), form));
    refresh();
  }

  function toolCard(tool, existing = false) {
    const price = existing
      ? tool.monthlyCost === null ? 'Monthly cost unknown' : `${money(tool.monthlyCost)} / month · entered by you`
      : tool.toolId === 'general-assistant' ? 'Start with a free tier'
        : `${money(tool.monthlyPrice)} / month · estimated paid-plan cost${tool.status === 'TRY_FREE' ? '; start free' : ''}`;
    // No outbound CTA is enabled in M7.2. No provider-issued approved URL exists.
    return element('article', { class: 'sf-tool-card', 'data-tool-id': tool.toolId },
      element('header', {}, element('h3', { class: 'sf-tool-name' }, tool.name ?? toolNames[tool.toolId] ?? tool.toolId),
        element('span', { class: 'sf-status', 'data-status': tool.status }, tool.status.replaceAll('_', ' '))),
      element('p', { class: 'sf-price' }, price),
      tool.reasons.map(reason => element('p', { class: 'sf-reason' }, reason)));
  }

  function renderResults() {
    const [label, title, description] = STATES[result.state];
    const spend = (name, value) => element('div', {}, element('dt', {}, name), element('dd', {}, money(value)));
    const content = element('div', { class: 'sf-results', 'data-state': result.state, 'data-buy-nothing': String(result.buyNothing) },
      element('div', { class: 'sf-result-summary' }, element('span', { class: 'sf-state-label' }, label),
        element('h2', { class: 'sf-title', tabindex: '-1' }, title), element('p', { class: 'sf-lead' }, description)),
      element('dl', { class: 'sf-spend' },
        spend('Current monthly spend · entered by you', result.cost.currentUserEnteredMonthly),
        spend('Estimated new monthly spend', result.cost.recommendedNewMonthly),
        spend('Monthly spend to review for overlap', result.cost.overlapReviewMonthly)),
      element('p', { class: 'sf-note' }, result.cost.currentUserEnteredMonthly === null
        ? `Known entered subtotal: ${money(result.cost.currentKnownMonthly)}. Other subscription costs are unknown, so your total is unknown.`
        : 'Current spend uses only the amounts you entered. Overlap review does not imply guaranteed savings.'),
      element('p', { class: 'sf-note' }, 'Paid-plan amounts are comparison estimates, not current price quotes. Verify the provider’s pricing before paying. Free trials and optional tools add no committed spend here.'));
    if (result.audit.length) content.append(element('h3', { class: 'sf-section-title' }, 'Your existing tools'),
      element('div', { class: 'sf-card-grid', 'data-audit': '' }, result.audit.map(tool => toolCard(tool, true))));
    content.append(element('h3', { class: 'sf-section-title' }, 'New-tool decisions'),
      element('div', { class: 'sf-card-grid', 'data-recommendations': '' }, result.recommendations.map(tool => toolCard(tool))));
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
  }

  render(false);
}

const root = document.getElementById('stack-finder');
if (root) mountStackFinder(root);
