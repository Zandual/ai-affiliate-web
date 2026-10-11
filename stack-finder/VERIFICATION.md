# M7.4 final integrated verification

**Verdict: PASS — all five gates.** Verification completed October 10, 2026
(America/Chicago), against the M7.4 patch on
`experiment/ai-stack-finder-30d`, starting from M7.3 commit
`a4297991be25fe0aa27b49a45eeabfaf78397015`.

This record covers developer verification for Issue #7. Human validation was not
started. No deployment, merge to `main`, affiliate activation, or provider-side
conversion tracking was performed.

## Final gate evidence

| Gate | Verdict | Evidence |
|---|---|---|
| 1. Regression | PASS | Exact regression command: 60 passed, 0 failed; all 36 frozen scenarios and all 6 trust invariants passed. Separate analytics command: 19 passed, 0 failed. No frozen expectations or engine files changed. |
| 2. Result-state semantics | PASS | Twenty Chrome journeys: ten normal and ten explain-mode runs, covering all eight engine states. State, buy-nothing flag, headings, descriptions, spend, audit cards, and ordered recommendation cards matched between modes. Each recommendation's order, classification, and reasons also matched a direct engine call. |
| 3. Affiliate isolation | PASS | Metadata mutation and throwing-getter tests passed for approval, referral URL, commission, cookie/attribution windows, and payout terms. Complete engine output stayed identical. Twenty browser results had zero affiliate anchors, including covered, gap, constrained, and existing-specialist cases. |
| 4. UI/accessibility | PASS | Keyboard-only intro-to-results/restart journeys at 1280×900, 390×844, and 320×740; 135 visible/unobscured focus checks. Accessible progress, labels, native keyboard actions, reverse/forward escape, reduced motion, and responsive geometry passed after the corrections below. Screenshots were visually inspected. |
| 5. Analytics separation | PASS | Normal mode: 10 starts, 50 question events, 10 completions, 28 observed card views, zero explanation/outbound events. Explain mode: 10 starts, 50 question events, 10 completions, 30 opened explanations, 30 card views, zero outbound events. Isolated fixture: two trusted outbound activations and 15 rejected cases; no provider facts or provider network requests. |

PASS is limited to the verified scope below, not a claim of comprehensive WCAG
certification or evidence of a provider conversion.

## Commands and exact results

Run from the repository root:

```sh
node --test stack-finder/tests/stack-finder.test.mjs
node --test stack-finder/tests/analytics.test.mjs
```

| Suite | Tests | Suites | Passed | Failed | Skipped | Cancelled |
|---|---:|---:|---:|---:|---:|---:|
| Regression | 60 | 4 | 60 | 0 | 0 | 0 |
| Analytics | 19 | 5 | 19 | 0 | 0 | 0 |

Regression includes **36/36 frozen scenarios PASS** and **6/6 trust invariants
PASS**. Both commands were rerun after the M7.4 code corrections. The four M7.1
files, `ui.js`, `analytics.mjs`, and `tests/analytics.test.mjs` remain unchanged
from the M7.3 base. `AppEntry.js` and `spark.js` are also unchanged.

## Reproduced defects and bounded corrections

1. **Host control obscured on reverse navigation.** Start the Finder and press
   Shift+Tab from the focused question legend. The existing `#breathSpeed` slider
   received focus behind the Finder. Chrome hit-testing returned the Finder
   header at the slider's center. Its accessible name was also empty. The host
   panel now rises above the Finder only while it contains focus; the slider
   has an explicit accessible name and a white focus outline. Reverse navigation
   now reveals it at all three viewports, and Tab returns to the Finder without
   changing questionnaire answers.
2. **Live reduced-motion preference ignored by host effects.** Load with no
   preference, then enable reduced motion. The body stopped animating, but the
   existing title spans retained their `breath` animations and the spark canvas
   remained displayed. Scoped CSS now stops the title animation and hides the
   canvas whenever reduced motion is requested. Both initial reduced preference
   and a live change passed. Finder itself has no animations and uses instant
   question-title scrolling.
3. **Numeric-control border contrast below 3:1.** `#879b8b` measured 2.96:1
   against white and 2.73:1 against the Finder paper background. The input and
   secondary-button border now uses `#7b8f7f`: 3.46:1 and 3.18:1 respectively,
   calculated using WCAG relative luminance. No dimensions or decision behavior
   changed.

## Browser and accessibility checks

Chrome **155.0.8059.39**, driven through Playwright CLI against the actual
`index.html` integration and a local HTTP server. The checks used native browser
keyboard input, accessibility-tree snapshots, computed styles, DOM geometry,
hit-testing, and visual screenshot inspection.

At each of the three viewports:

- Tab reached controls in document order; Shift+Tab moved backward. Navigation
  could leave the Finder in both directions and return. No focus trap occurred.
- Enter started the questionnaire and submitted valid steps. Enter selected a
  radio/checkbox without prematurely submitting. Arrow keys changed radio
  choices; Space toggled checkboxes and buttons. Enter and Space opened/closed
  native explanation and answer-summary disclosures.
- Focus moved to the current question legend or result heading. Focused controls
  had a visible 3px outline and an unobscured center. Geometry checks allowed one
  CSS pixel for Chrome's fractional scroll rounding.
- Every step exposed visible `Question X of 5`, a status entry, and a native
  progressbar named `Question X of 5`, with value X and maximum 5, in Chrome's
  accessibility tree. Inputs had labels; status chips contained text rather than
  relying on color.
- Keyboard multi-selection worked; Nothing cleared other tools. Keyboard restart
  after results returned to the intro, and a new start had no selected answers.
- Back/Next preserved answers. Invalid negative/fractional amounts could not
  advance. Explicit zero remained $0.00; unknown costs stayed unknown. Overlap
  costs were $45.00 when entered and Unknown when one cost was cleared.
- Eleven geometry checkpoints covered intro, all five questions, selected-tool
  costs, exact budget, results, expanded explanation, and expanded answers.
  Finder `scrollWidth` equaled `clientWidth`: 1078px at desktop, 364px at 390px,
  and 294px at 320px. No control/card/label extended outside the Finder or
  horizontal viewport. Buttons, disclosure summaries, and numeric fields were
  at least 44px high. Long pages remained reachable through ordinary vertical
  scrolling; open result and explanation cards wrapped readably.
- Initial and live reduced-motion checks reported body/title animation `none`,
  spark canvas display `none`, and zero Finder animations.

No uncaught JavaScript errors occurred in the result-state journeys. The host's
pre-existing `/api/products` 404 in a static preview is described below.

## Trust and analytics checks

The ten scenarios in [README.md](README.md#reproduce-result-states), including
both coding and automation catalog gaps, were run in normal mode at desktop and
again in explain mode at 320px. All eight states remained distinct:

- `COVERED_BUY_NOTHING`: zero purchase CTAs; only SKIP new-tool decisions.
- `COVERED_KEEP_EXISTING`: Descript KEEP in the audit, no duplicate Descript
  recommendation, no adjacent upsell.
- `REVIEW_OVERLAP`: review language and unknown costs preserved.
- `RECOMMENDATIONS`: ADD and TRY_FREE cases preserved.
- `BUDGET_CONSTRAINT`: explicitly outside budget, buy-nothing flag false.
- `NO_STRONG_RECOMMENDATION`: OPTIONAL retained without a confident paid ADD.
- `CATALOG_GAP`: explicitly unvetted coverage, buy-nothing flag false.
- `RECOMMEND_GENERIC_GENERAL`: generic free starting point retained.

Ten paired DOM decision snapshots were identical between normal and explain
mode. All 30 explanation panels matched the engine's six score components,
total, hard gates, and final classification. Normal mode had no debug panels.
The production Finder has no configured outbound anchors; null or unapproved
affiliate metadata cannot create a monetized CTA through its renderer.

The existing isolated outbound browser fixture was rerun after the corrections.
It imported the real analytics module, attached test-only approval after an
engine decision, and intercepted the reserved `https://example.invalid/`
destination. It was never added to the production catalog or page. Mouse and
keyboard activation produced exactly two `outbound_affiliate_click` records.
Fifteen cases produced no click event: unapproved, null URL, buy nothing, SKIP,
OPTIONAL, catalog gap, budget constraint, generic assistant, disabled anchor,
changed href, revoked approval, later-listener cancellation, removed binding,
synthetic click, and old binding after reset.

The fixture emitted only start/click names. It did not create provider signup,
paid conversion, approved commission, revenue, or cash payout facts, and sent no
request to a provider. Payloads contained only the versioned envelope and
allowlisted categorical fields. A reproducible isolated positive/canceled probe
and all six event schemas are included in the [M7.3 guide](README.md#m73-explain-mode-and-local-analytics).

## Reproduce locally

From the repository root on the experiment branch:

```sh
python -c "from http.server import SimpleHTTPRequestHandler,test; SimpleHTTPRequestHandler.extensions_map['.mjs']='text/javascript'; test(HandlerClass=SimpleHTTPRequestHandler,port=4173,bind='127.0.0.1')"
```

Open `http://127.0.0.1:4173/#stack-finder` for the normal Finder, or
`http://127.0.0.1:4173/?sf_explain=1#stack-finder` for explain mode. The verification
session used the equivalent server on port 4175. Serve `.mjs` as JavaScript; do
not open the page as a `file:` URL.

Repeat the README scenario table. For keyboard QA, use Tab, Shift+Tab, arrow
keys, Enter, and Space through all five questions and restart from results.
Include reverse navigation from a freshly focused question title to the host
slider. Inspect the accessibility tree's status/progressbar on every step.
Repeat at 1280×900, 390×844, and 320×740. Open explanation panels, cost fields,
and the answer summary, then inspect wrapping and horizontal overflow. Toggle
the browser's reduced-motion emulation both before loading and while the page
is already loaded.

## Changed-file scope

M7.4 changes only `index.html`, `stack-finder/styles.css`,
`stack-finder/README.md`, and this `stack-finder/VERIFICATION.md`.

Cumulative changed files since verified M7.1 commit
`7b97cb2607c0432865d2f9ef15859d7da8fd5871`:

- `index.html`
- `stack-finder/README.md`
- `stack-finder/VERIFICATION.md`
- `stack-finder/analytics.mjs`
- `stack-finder/styles.css`
- `stack-finder/tests/analytics.test.mjs`
- `stack-finder/ui.js`

`main` was read for verification only and remained at
`f05f8c63fa959d2f286bc20735bbb98cc6b63422`. No main checkout or merge occurred.

## Known limitations

- Browser QA used desktop Chrome with responsive viewport emulation. Physical
  mobile devices, Safari/Firefox, and an actual screen-reader session were not
  tested; machine-readable semantics were verified in Chrome's accessibility
  tree. This is not an exhaustive accessibility certification.
- The static host preview requests `/api/products`, which returns 404 without
  its legacy backend. The Finder operates independently of that endpoint.
- Reduced-motion CSS hides the already-running spark canvas. Its pre-existing
  animation loop may still run invisibly after a live preference change;
  `spark.js` was not redesigned.
- No approved affiliate links, telemetry transport/storage, provider attribution,
  or revenue reporting were activated. View events require IntersectionObserver;
  deferred outbound events can be lost if a page unloads first.
- Prices remain the frozen decision fixtures, not live provider quotes.

M7.4 stops with this integrated verification. Human validation has not begun.
