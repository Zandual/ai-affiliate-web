# Stack Finder preview and UI verification

The final M7.4 [five-gate verification record](VERIFICATION.md) includes the
accessibility corrections, exact test counts, integrated browser evidence,
reproduction steps, changed-file scope, and known limitations.

## Validation page isolation

Open the root page with the exact `#stack-finder` fragment to select validation
mode, for example `http://127.0.0.1:4173/?sf_explain=1#stack-finder`. Query
parameters, explain mode, and UTM attribution retain their existing behavior.

Previously, `index.html` created both `#stack-finder` and the legacy `#root` and
unconditionally loaded both entry points. `ui.js` calls `mountStackFinder()` on
the Finder section. Separately, `AppEntry.js` registers the Expo app and calls
`runApplication('main', { rootTag })` on `#root`. Its Home screen fetches
`/api/products`, then renders the product cards; its navigation also exposes the
Dashboard. Both applications were therefore live in one document. The legacy
root's `min-height: 100vh` would leave a blank area even if only the bundle were
skipped.

`page-mode.mjs` now leaves the legacy root inside an inert HTML template in
validation mode and never loads `AppEntry.js` or `spark.js`. There is no live
legacy root and no legacy product request. Validation-scoped styles hide the
preserved Home demo header/canvas/wipe and remove its reserved Finder spacing.
The document ends naturally after Finder, with the shared background retained.
No generic card selectors or generated bundle edits are used.

Legacy work is preserved: both generated AppEntry bundles, their Home/product
card/Dashboard implementations, `spark.js`, and `functions/api/[[path]].js` are
unchanged. Product data is supplied by the existing backend through that API;
the named deployed products are not a separate seed file in this repository.
Neither backend records nor API behavior were changed or deleted.

To intentionally render the legacy experience, open `/` without `#stack-finder`
(for example `http://127.0.0.1:4173/`). The template becomes the original live
`#root`, then the original bundle and spark script load in order. Crossing
between validation and legacy mode through a fragment change reloads the page,
so an already-running Expo app cannot survive in validation mode. This clears
unsaved Finder answers, as an ordinary reload does. Finder's own Back and
restart buttons do not change the fragment or reload.

### Isolation verification — October 15, 2026

Based on `e11ca8c5bf22a95fc2817ae80e9bdfbac6dd5b55`:

| Exact command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `node --test stack-finder/tests/stack-finder.test.mjs` | 60 | 0 | 0 |
| `node --test stack-finder/tests/analytics.test.mjs` | 19 | 0 | 0 |
| `node --test stack-finder/tests/posthog.test.mjs` | 22 | 0 | 0 |
| `node --test stack-finder/tests/page-mode.test.mjs` | 6 | 0 | 0 |

All **36 frozen scenarios** and **6 trust invariants** passed. The focused guard
checks inert validation mounting, retained legacy mounting and script order,
mode-change cleanup/reload, and the HTML entry-point wiring without relying on
product copy or styling.

Chrome **155.0.8059.39** completed recommendation, BUY NOTHING, and CATALOG GAP
journeys at **1280px, 390px, and 320px**. All nine journeys passed intro, five
questions, Back, results, Back to answers, explain mode, and Start over. Across
93 checkpoints, no legacy root ever mounted, no legacy product/Dashboard content
appeared, and no AppEntry, spark, or `/api/products` request occurred. No
horizontal overflow, replacement blank area, or uncaught error was found.
Result/explanation cards and the footer were visually inspected.

The unchanged analytics architecture dispatched all five requested lifecycle,
view, and explanation event types; **93 real SDK-generated capture requests**
across the nine journeys were intercepted and decoded to verify those types
also reached the transport. No PostHog configuration, event contract, or token
was changed. A separate normal-mode journey completed with PostHog blocked and
no debug panels. Legacy → validation → legacy navigation also passed: an
isolated local API fixture rendered both named product cards and Dashboard
outside validation, while validation made zero product requests. The fixture
changed no backend data and was not added to production source.

This verifies local Chrome behavior, not a new Cloudflare deployment or PostHog
dashboard receipt. Historical milestone records below retain their original
results, including the legacy API activity observed before page isolation.

The bounded PostHog bridge described below is a later addition to the verified
M7 baseline. The M7.3 local analytics contract remains unchanged; its historical
verification record later in this guide predates network transport.

## Bounded PostHog validation transport

`index.html` loads `posthog.mjs` independently before `ui.js`. The bridge listens
on the Finder mount for the existing bubbling `stack-finder:analytics` event.
It has no input to recommendation decisions and imports only the event contract
from `analytics.mjs`. Engine, catalog, pricing, affiliate eligibility, UI
semantics, and frozen expectations are unchanged.

The bridge asynchronously loads pinned PostHog JS **1.380.0** from the official
US asset host. It creates the named `stackFinderValidation` instance with the
existing **public browser project token** for AI Stack Finder Validation
(project 661807), sending to `https://us.i.posthog.com`. No Personal API Key or
build dependency is used. An existing host PostHog instance is left alone; the
bridge becomes a no-op instead of borrowing or reconfiguring it.

### Allowed data and collection settings

Each incoming envelope is validated and copied into a fresh object by explicit
property reads. Unknown names, invalid ordinals/categories, and throwing required
getters are rejected. Unapproved/private fields are never read or enumerated.
Only these events and event-specific properties are forwarded:

| Event | Additional properties |
|---|---|
| `finder_started` | none |
| `question_answered` | `question` (1–5) |
| `finder_completed` | `state` (an existing engine state) |
| `recommendation_viewed` | `state`, `toolId`, `classification` |
| `recommendation_explanation_opened` | `state`, `toolId`, `classification` |
| `outbound_affiliate_click` | `state`, `toolId`, `classification` |

Each record also carries `version`, page-local `runId`, and `sequence`. Tool and
classification values use the existing analytics allowlists; this does not send
the user's selected existing tools. Approved attribution is read once per page:

| Parameter | Exact accepted values |
|---|---|
| `utm_source` | `manual`, `facebook`, `instagram`, `threads`, `youtube` |
| `utm_medium` | `qa`, `social`, `video` |
| `utm_campaign` | `posthog_smoke`, `validation_30d` |

Unknown values, repeated parameters, and all other query parameters are omitted.
No full URL/query string, referrer, names, emails, phone numbers, raw answers,
existing-tool selections, entered costs, exact budgets, free text, scores,
referral URLs, or affiliate economics are forwarded.

PostHog normally adds automatic metadata. A second, final `before_send` boundary
rebuilds the entire event and properties, discarding that enrichment, including
top-level `$set` / `$set_once`. It adds only the required public project token,
a random **page-lifetime anonymous UUID** as `distinct_id`, and
`$process_person_profile: false`. This UUID changes on reload and is never linked
to an account or persisted. `identify()` is never called.

Autocapture, pageview/pageleave, recording/replay, heatmaps, surveys, feature-flag
requests, external dependency loading, performance capture, exception capture,
dead/rage clicks, console recording, referrer/campaign auto-capture, and IP
enrichment are disabled. `person_profiles` stays `identified_only`; persistence
is memory-only and disabled. `index.html` sets `no-referrer` to suppress the HTTP
Referer header as well as filtering referrer properties. The loader also sets
`referrerPolicy: 'no-referrer'`. No PostHog cookies, localStorage, or sessionStorage
entries were present in the verified browser journeys.

### Failure isolation and interpretation

The listener registers before SDK loading. Up to 100 already-sanitized records
wait in memory and flush in order when the SDK becomes ready. Loading times out
after eight seconds. Missing/blocked/failed initialization drops the queue;
synchronous capture errors and rejected promises are contained. Batching is
disabled. Duplicate initialization reuses one listener, and stopping is
idempotent. Neither SDK availability nor delivery results feed back into Finder.

**outbound click != signup != conversion != approved commission != revenue != payout**

The bridge forwards only the existing client action. It cannot create any of
those provider facts. Affiliate links remain disabled because there are no
approved provider-issued URLs in the production catalog. No link was fabricated
or activated for this transport implementation.

### Smoke-test procedure

1. Start the local server using the command under **Run locally** below. Open
   `http://127.0.0.1:4173/?utm_source=manual&utm_medium=qa&utm_campaign=posthog_smoke#stack-finder`
   in ordinary/headed Chrome. The vendor's default bot filter suppresses
   HeadlessChrome; do not disable that filter in production to make a test pass.
2. Open DevTools Network before starting. Complete Video / podcast → Nothing →
   Daily → exact $75 → Time. Expect `RECOMMENDATIONS` with Descript ADD. The first
   seven capture requests should be start, five question events, then completion
   with sequence 1–7. Views follow only when cards become visible.
3. Inspect the decompressed `/e/` request body (the SDK sends gzip). It must
   contain only the fields documented above. Its HTTP Referer header must be
   absent. Adding arbitrary query parameters must not add payload properties.
   Tests can intercept collector requests and return `{"status":1}` to avoid
   creating test data in PostHog. Interception proves the outgoing request,
   not server receipt or dashboard ingestion.
4. Add `&sf_explain=1` before the fragment to enable explain mode. Opening a
   recommendation panel emits one explanation event; leaving it closed does not.
   Back to answers and resubmission preserve the result without another
   completion. Start over clears answers and starts a new local run.
5. Block the SDK asset or ingestion host in DevTools and reload. Complete the
   same journey, Back, and restart. Finder must work with the same results.
   Check 390px and 320px widths for overflow, including open explain panels.

An example sanitized completion body is below; transport values are placeholders:

```json
{
  "event": "finder_completed",
  "properties": {
    "version": 1, "runId": 1, "sequence": 7,
    "state": "RECOMMENDATIONS",
    "utm_source": "manual", "utm_medium": "qa", "utm_campaign": "posthog_smoke",
    "token": "<public project token>",
    "distinct_id": "<random page-lifetime UUID>",
    "$process_person_profile": false
  }
}
```

### Verification — October 15, 2026

Based on `30eddecc97ee1e08aaf37c3d8437e723d4d27541`, with no frozen files changed:

| Exact command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `node --test stack-finder/tests/stack-finder.test.mjs` | 60 | 0 | 0 |
| `node --test stack-finder/tests/analytics.test.mjs` | 19 | 0 | 0 |
| `node --test stack-finder/tests/posthog.test.mjs` | 22 | 0 | 0 |

The regression total includes **36/36 frozen scenarios** and **6/6 trust
invariants**. New tests cover all six forwarded events, forbidden provider-fact
events, strict property reads/getters, UTM filtering, SDK metadata stripping,
bounded queueing, absent/throwing/rejected transport, timeout, repeated setup and
cleanup, and identical engine output with transport available or unavailable.

Headed Chrome **155.0.8059.39** completed eight full journeys: enabled SDK,
blocked SDK, throwing capture, rejected capture, blocked ingestion, disabled
bridge, unknown UTM values, and delayed SDK. All passed intro, five questions,
result, Back to answers, and restart. Results matched between modes. Desktop
1280px and mobile 390px/320px had no horizontal overflow or uncaught errors.
Explain mode opened and emitted only after opening. All production results had
zero outbound anchors. Six SDK-enabled page loads used six distinct anonymous
IDs, with empty cookies/localStorage/sessionStorage.

The final eight-journey probe inspected **43 actual SDK-generated outgoing
requests**, including requests aborted in the network-failure case. It decoded
the gzip bodies and checked the exact property allowlist and lifecycle order.
No flags, replay, surveys, or other product requests occurred. A separate journey
entered ChatGPT cost `$19.43` and exact budget `$75.13`: all **11** outgoing
requests omitted those values, selected tools, raw answers, extra query values,
URLs/referrers, scores, and affiliate economics. Direct SDK attempts to capture
seven automatic/provider-fact names produced **zero additional requests**.
Open explain cards also fit 390px and 320px. Collector requests were intercepted;
the real pinned SDK was loaded from its official host throughout.

The initial no-request probe used HeadlessChrome, which the SDK's default bot
filter blocks. Repeating with headed Chrome produced the expected request
without changing production bot filtering, batching, or privacy settings. The
only discovered bridge defect was repeat-stop cleanup deleting a replacement
listener's registry entry; idempotent cleanup fixed it and its regression passes.

Limitations: this verifies Chrome and outgoing requests, not PostHog dashboard
receipt, other browsers, or delivery guarantees. Ad blockers, unload, failed
loads, and the bounded queue can lose events. No cross-page identity or retention
measurement is available. HTTPS/localhost with `crypto.randomUUID` is required;
unsupported environments safely omit transport. HTTP still necessarily exposes
network IP and ordinary browser headers to the service; these are not included
in event properties and SDK IP enrichment is disabled. The existing unrelated
static-preview `/api/products` 404 remains. Node emits its MockTimers experimental
warning for the timeout unit test; the test passes. This work does not deploy the
site, activate affiliate links, or start participant validation.

Configuration references: [PostHog JS configuration](https://posthog.com/docs/libraries/js/config),
[before_send](https://posthog.com/docs/libraries/js/usage#amending-or-sampling-events),
[client bot filtering](https://posthog.com/docs/web-analytics/troubleshooting#do-stats-include-bots-and-crawlers).

M7.2 mounts the five-question Finder alongside the existing site. The UI uses the
M7.1 engine for decisions. The scenarios below are reproducible browser checks;
the M7.2 verification record is preserved below. M7.3 reproduction instructions
follow that record.

## Run locally

From the repository root on `experiment/ai-stack-finder-30d`:

```sh
node --test stack-finder/tests/stack-finder.test.mjs
python -c "from http.server import SimpleHTTPRequestHandler,test; SimpleHTTPRequestHandler.extensions_map['.mjs']='text/javascript'; test(HandlerClass=SimpleHTTPRequestHandler,port=4173,bind='127.0.0.1')"
```

Keep the server running and open
[the local Finder](http://127.0.0.1:4173/#stack-finder). Use HTTP rather than opening
`index.html` directly, so browser module imports work. The server must serve `.mjs`
files with a JavaScript MIME type. The command above sets this explicitly because
Windows can otherwise serve them as `text/plain`, which browsers block as modules.
Stop the server with Ctrl+C.

Outside `#stack-finder` validation mode, the existing Expo app may request
`/api/products` and receive a 404 in this static preview because its legacy API
is unavailable. Validation mode does not start that app or request the endpoint.

## Reproduce result states

Start a fresh Finder run for each row. Answer the questions in order: primary job,
existing tools, usage frequency, total monthly budget, and biggest pain. Select
`Nothing` when the table shows no existing tools. Enter the listed dollar amount
using the exact-budget option; each row includes the required pain answer.

| Check | Primary job | Existing tools | Frequency | Exact budget | Pain | Expected engine state and visible result |
|---|---|---|---|---:|---|---|
| Covered general | General work | ChatGPT | Occasional | $25 | Time | `COVERED_BUY_NOTHING`; keep the assistant, buy nothing new; specialists SKIP. |
| Keep specialist | Video / podcast | Descript | Weekly | $75 | Time | `COVERED_KEEP_EXISTING`; Descript KEEP, no duplicate or adjacent upsell. |
| Review overlap | General work | ChatGPT and Claude | Daily | $75 | Cost | `REVIEW_OVERLAP`; both assistants need review, without choosing a winner. |
| Paid recommendation | Video / podcast | Nothing | Daily | $75 | Time | `RECOMMENDATIONS`; Descript ADD; unrelated specialists SKIP. |
| Budget constraint | SEO / content | Nothing | Daily | $25 | Time | `BUDGET_CONSTRAINT`; Writesonic SKIP; this is distinct from buy nothing. |
| No strong recommendation | SEO / content | Nothing | Monthly | $150 | Time | `NO_STRONG_RECOMMENDATION`; Writesonic OPTIONAL, never ADD. |
| Catalog gap | Coding | Nothing | Daily | $150 | Time | `CATALOG_GAP`; no confident vetted specialist, distinct from buy nothing. Repeat with Automation / operations. |
| Generic baseline | General work | Nothing | Weekly | $25 | Time | `RECOMMEND_GENERIC_GENERAL`; One general AI assistant, TRY FREE. |
| Specialist free tier | Voice / audio | Nothing | Daily | $0 | Cost | `RECOMMENDATIONS`; ElevenLabs TRY FREE, no paid new spend. |

The interface may use readable headings instead of engine state identifiers.
Confirm that each meaning remains distinct, with plain-language explanations and
text labels for KEEP, ADD, TRY FREE, OPTIONAL, and SKIP. New candidates and existing
tools must appear separately.

## Interaction and cost checks

- Complete all five questions with the keyboard: use Tab/Shift+Tab, arrow keys for
  radio groups, and Space/Enter where appropriate. Check visible focus, a logical
  focus order, progress updates, labeled inputs, and disabled Continue until a
  required answer is valid.
- Before submitting, go Back from question 5 to question 1 and forward again.
  Selected answers and entered monthly costs must remain intact.
- Select ChatGPT and Claude, then select Nothing. Nothing must clear tool
  selections. Selecting a tool afterward must clear Nothing.
- Use Restart after results. Confirm that answers, tool selections, costs, and
  previous results are cleared before a new run.
- Run Covered general with ChatGPT's monthly cost blank, then repeat with `0`.
  Blank means unknown; zero means an explicitly entered free subscription. The
  current-spend display must distinguish them, and neither run adds paid spend.
- Run Review overlap with entered costs of `$20` and `$25`. The overlap-review
  amount is `$45`, not promised savings. Leave either cost blank and confirm the
  complete overlap total becomes unknown rather than a guessed price.
- Run Paid recommendation with no existing tools. Recommended new paid spend is
  `$24` under the frozen fixture. Repeat the free-tier and OPTIONAL rows: neither
  adds a committed paid subscription to the new-spend total.
- Try an empty, negative, or nonnumeric exact budget and an invalid monthly tool
  cost. The flow must explain invalid entries without silently changing them into
  a valid recommendation. Confirm exact `$0` and entered monthly cost `$0` work.
- Check the same flow at a desktop viewport and a narrow mobile viewport (for
  example 390 × 844). Confirm no horizontal clipping, readable results, visible
  controls and focus, and touch targets of approximately 44px or larger. Check
  reduced-motion behavior using the browser's accessibility/emulation settings.

Record the branch SHA, browser, viewport, completed rows, and any failures when
performing verification. Re-run the engine test command after UI changes; all 36
frozen scenarios and trust invariants must remain green.

## Scope and interpretation

- Prices are frozen decision fixtures, not verified live provider quotes:
  Descript `$24`, ElevenLabs `$6`, and Writesonic `$99` per month.
- Budget bands use `$25`, `$75`, and `$150` ceilings. The open-ended `$150+` band
  conservatively uses `$150`; use an exact budget to represent a different amount.
- Blank existing costs stay unknown. Entered costs are preserved. Overlap review
  does not imply cancellation and does not create estimated savings.
- External purchase/affiliate CTAs remain disabled because no approved referral
  links are configured. BUY NOTHING, CATALOG GAP, and SKIP must not offer a
  purchase action. Recommendation scoring is independent of affiliate status.
- The M7.2 verification below predates analytics wiring. M7.3 adds the local
  event contract documented later in this guide; neither milestone activates
  affiliate links, provider conversion tracking, or production deployment.

## M7.2 verification performed — October 8, 2026

- Chrome 154.0.8037.59, through Playwright CLI: all ten complete questionnaire
  runs passed (the nine table rows, plus the automation repeat). All eight engine
  result states and KEEP, ADD, TRY FREE, OPTIONAL, and SKIP rendered correctly.
- Every tested result contained zero outbound anchors. Covered results retained
  buy-nothing semantics; budget constraints and catalog gaps did not.
- Back/forward through all five questions and Back from results preserved
  answers. Restart cleared every answer and cost. Nothing cleared tool choices
  and costs; selecting another tool deselected Nothing.
- Blank costs stayed unknown; entered zero displayed $0.00. Entered overlap
  costs totaled $45.00, becoming Unknown when one cost was cleared. Invalid
  negative amounts and fractional cents could not advance; exact zero worked.
- Keyboard-only intro-to-results passed with Tab, Shift+Tab, arrow keys, Enter,
  and Space. Reduced motion and the existing host preference were respected.
- Desktop 1280×720 and narrow 390×844 / 320×740 layouts were checked, including
  scrolled cost inputs and results. No horizontal Finder overflow was detected.
- `node --test stack-finder/tests/stack-finder.test.mjs`: 60 passed, 0 failed;
  includes all 36 frozen scenarios and all 6 trust invariants. The four M7.1
  files and `AppEntry.js` remain unchanged from the verified M7.1 commit.

These are Chrome browser checks, not screen-reader or cross-browser certification.

## M7.3: explain mode and local analytics

This section describes how to reproduce M7.3 checks; completed results are
recorded below. The M7.1 decision engine and its frozen expectations remain
unchanged.

### Open explain mode and capture events

Start the local server using the command above, then open
[the Finder with explain mode enabled](http://127.0.0.1:4173/?sf_explain=1#stack-finder).
The query switch is `?sf_explain=1`; the `#stack-finder` fragment positions the
Finder. Open Chrome DevTools and run this snippet **before** selecting
`Find my stack`:

```js
(() => {
  globalThis.sfAnalyticsReview?.stop();
  const events = [];
  const capture = event => {
    events.push(event.detail);
    console.log(event.detail);
  };
  document.addEventListener('stack-finder:analytics', capture);
  globalThis.sfAnalyticsReview = {
    events,
    stop: () => document.removeEventListener('stack-finder:analytics', capture),
  };
})();
```

Complete a questionnaire using one of the result-state rows above. Scroll the
new-tool cards into view, then open an `Explain recommendation` panel. Each new
recommendation, including SKIP and the generic general-assistant recommendation,
exposes the engine's job fit, frequency fit, budget fit, unique capability,
overlap penalty, problem modifier, score total, triggered hard gates, and final
classification. The UI displays these returned values without recalculating them.
Existing-tool audit cards are separate from new recommendations.

Inspect the captured records with `sfAnalyticsReview.events`. Run
`sfAnalyticsReview.stop()` when finished. The capture snippet keeps records only
in this page's memory; reload removes both the records and the listener. If you
reload, install the listener again before starting. Use `Start over` to clear the
Finder and begin another run while retaining the review capture.

Without the query switch, the existing concise customer-facing reasons remain
visible and the development panels are absent. In M7.3,
`recommendation_explanation_opened` measures opening those development panels;
it is not evidence of a production customer opening a separate explanation UI.

### Event contract and sample payloads

The UI dispatches one local, bubbling `stack-finder:analytics` CustomEvent for
each accepted record. Its `detail.event` is restricted to the following six
logical event names:

| Event | Sample `payload` | When it is recorded |
|---|---|---|
| `finder_started` | `{}` | First `Find my stack` action in a run. |
| `question_answered` | `{ question: 1 }` | First successful Next/submission for each question, numbered 1–5. |
| `finder_completed` | `{ state: 'RECOMMENDATIONS' }` | First successful result in a run; later answer edits do not add completions. |
| `recommendation_viewed` | `{ toolId: 'descript', classification: 'ADD', state: 'RECOMMENDATIONS' }` | A new-tool card meets the viewport visibility rule below. |
| `recommendation_explanation_opened` | `{ toolId: 'descript', classification: 'ADD', state: 'RECOMMENDATIONS' }` | A connected development explanation panel changes to open. |
| `outbound_affiliate_click` | `{ toolId: 'descript', classification: 'ADD', state: 'RECOMMENDATIONS' }` | A qualifying trusted activation of an enabled, approved outbound anchor. No production anchor is configured. |

Every record uses the same immutable envelope. For example, the first completion
after a start and five question submissions has this shape:

```js
{
  version: 1,
  event: 'finder_completed',
  runId: 1,
  sequence: 7,
  payload: { state: 'RECOMMENDATIONS' }
}
```

`runId` is an ordinal local to the mounted Finder, not a persistent visitor ID.
`Start over` resets deduplication; the next start increments `runId` and begins
`sequence` at 1. Reload creates a new local instance. Back navigation does not
start a new run. Each question and the first completion count once per run, even
when users revisit answers or produce a different result state.

Views and explanation openings count once per `(state, toolId, classification)`
within a run. A changed classification or result state can therefore produce a
new card event, while reopening the same panel or rerendering the same result
does not inflate its count. A view requires an IntersectionObserver report with
at least 25% of the card intersecting the viewport while the document is visible.
Offscreen cards are not counted merely because the result rendered. Observers
are disconnected on Back/Restart; stale results and detached cards are ignored.
This measures card exposure, not attention, understanding, or a purchase.

Payloads contain only allowlisted question numbers, engine states, tool IDs, and
classifications. They exclude answer text, entered costs, exact budgets, scores,
referral URLs, personal identifiers, and provider economics. The module makes no
network request and writes no storage. Sink failures must not interrupt the
Finder or change a recommendation.

### Outbound actions and provider facts

`bindAffiliateClick` is available for a future approved outbound integration, but
is intentionally **not wired to the production Finder**: no approved
provider-issued referral URLs are configured. Rendering a card, opening an
explanation, or clicking a disabled/null/unapproved action must produce no
`outbound_affiliate_click` event.

The helper requires a connected anchor, an approved absolute HTTPS URL that
matches its actual destination, an eligible engine recommendation, and a
trusted primary click/keyboard activation or middle-click. It rejects disabled,
hidden/inert, download, same-origin, synthetic, ineligible, and canceled actions.
The cancellation check runs in a later task so a subsequent event listener can
prevent navigation. Reset invalidates old bindings. Multiple bindings cannot
count the same event more than once.

Positive browser proof must use an isolated browser route fixture importing the
real analytics module, with a test-only anchor/configuration and an intercepted
destination. Activate it through browser input, rather than `element.click()` or
`dispatchEvent()`, which are synthetic. Keep that fixture outside the production
Finder. Its approval flag is test data, not provider approval or affiliate
activation. Verify a positive event and the blocked/canceled cases separately;
Node tests deliberately do not manufacture `isTrusted: true`.

An outbound click records only the client action. This event contract cannot
create or infer a provider signup, paid conversion, approved commission, revenue,
or cash payout. Those would require independent provider-side evidence and are
not implemented here.

### Regression and isolation checks

Run both suites from the repository root:

```sh
node --test stack-finder/tests/stack-finder.test.mjs
node --test stack-finder/tests/analytics.test.mjs
```

The unchanged M7.1 baseline must remain 60 passed, 0 failed, including all 36
frozen scenarios and all six trust invariants. The separate M7.3 suite checks the
event allowlist, payload projection, lifecycle/deduplication, sink isolation,
invalid outbound inputs, and separation from provider facts. It also varies
affiliate approval, URL availability, commission, cookie/attribution windows, and payout
terms, including fields whose getters throw if read: recommendation results must
remain identical. Analytics receives decision output after scoring and never
supplies inputs to ranking, state resolution, or classification.

For browser review, confirm the ordinary UI still renders the same result as
explain mode; all required debug fields match the engine output; Back and repeated
opening do not duplicate events; Restart creates a fresh run; and the normal
Finder emits no outbound event. Record actual Chrome version, branch SHA, test
results, and the isolated fixture evidence separately after verification.

### M7.3 limitations

- Browser QA is scoped to Chrome; cross-browser and screen-reader certification
  are not claimed.
- No server collector, persistent event store, provider attribution, conversion
  import, affiliate activation, or revenue reporting is implemented.
- `recommendation_viewed` requires IntersectionObserver. Browsers without it
  omit view events instead of assuming that every rendered card was seen.
- Development explanation events require `?sf_explain=1`. The ordinary page has
  no development panel to open.
- These are local observations, not proof of provider receipt or successful
  destination loading. A page may unload before deferred click delivery.

### M7.3 verification performed — October 10, 2026

Verified in Chrome 155.0.8059.39 through Playwright CLI, on the M7.3 changes based
on `bef0b083a934bb5321e6b5b6d43dd2828c6f6129`:

- `node --test stack-finder/tests/stack-finder.test.mjs`: **60 passed, 0 failed**,
  0 skipped; **36/36 frozen scenarios** and **6/6 trust invariants** passed.
- `node --test stack-finder/tests/analytics.test.mjs`: **19 passed, 0 failed**,
  0 skipped. All six jobs returned deeply identical complete results with
  unavailable, approved/high-commission, and unreadable affiliate metadata.
  Throwing getters covered approval, referral URL, commission rate, cookie and
  attribution windows, and payout terms. The four M7.1 files were unchanged.
- All ten result-state journeys above passed in normal mode, producing 10
  starts, 50 question events, 10 completions, and 28 observed card exposures.
  There were no explanation events or outbound events in those runs, no debug
  panels, and zero affiliate anchors in every result. All eight states and the
  existing classifications retained their meanings.
- Explain mode: Video / podcast → Nothing → Daily → exact $75 → Time produced
  Descript ADD. The panel exactly matched the engine: job fit 20, frequency 6,
  budget 4, unique capability 3, overlap 0, problem modifier 2, total 35, no hard
  gates, classification ADD. A Writesonic SKIP panel displayed
  `INSUFFICIENT_JOB_FIT`. Keyboard Enter opened the panel. No explanation event
  preceded opening; close/reopen did not duplicate the event. Opening another
  recommendation produced its own event.
- Back/recompletion and an answer edit producing CATALOG GAP kept one completion
  for the run. Restart cleared answers and produced run 2 / sequence 1. Next,
  Back, multi-select, Nothing exclusivity, validation, zero versus unknown costs,
  and the $45 versus unknown overlap total all passed again.
- Explain panels were visually checked at desktop 1280×900 and mobile 390×844
  and 320×844. No horizontal Finder overflow; summary targets were at least
  44px high. No uncaught browser errors. The pre-existing static-preview
  `/api/products` 404 remains unrelated to the Finder.
- Outbound proof used a separate, route-fulfilled browser page, importing the
  real module and attaching test approval only after an engine decision. All
  `https://example.invalid/fixture-only` destinations were intercepted in the
  browser; no provider request was sent. Mouse and keyboard activation produced
  exactly two distinct `outbound_affiliate_click` records, each containing only
  `toolId: 'descript'`, `classification: 'ADD'`, and `state: 'RECOMMENDATIONS'`.
  Fifteen negative checks passed: unapproved, null URL, buy nothing, SKIP,
  OPTIONAL, catalog gap, budget constraint, generic assistant, disabled anchor,
  changed href, revoked approval, later-listener cancellation, removed binding,
  synthetic click, and old binding after reset. Only start/click names appeared;
  no signup, conversion, commission, revenue, or payout facts were synthesized.
  The fixture was closed and was never added to production source or catalog.

For an independent positive/canceled browser probe, save the following as
`outbound-probe.js` in a **separate scratch directory**, with the local server
running on port 4173. Run it through a Playwright CLI Chrome session using
`playwright-cli run-code --filename=outbound-probe.js`. It creates and closes a
test page; the reserved `.invalid` URL is intercepted and is not an affiliate URL.

```js
async (page) => {
  const probe = await page.context().newPage();
  await probe.route('**/__outbound_probe__', route => route.fulfill({
    contentType: 'text/html',
    body: '<a id="test" target="sink">Test only</a><iframe name="sink"></iframe>',
  }));
  await probe.route('https://example.invalid/**', route => route.fulfill({
    contentType: 'text/html', body: 'Intercepted test destination',
  }));
  try {
    await probe.goto('http://127.0.0.1:4173/__outbound_probe__');
    await probe.evaluate(async () => {
      const { createAnalytics } = await import('/stack-finder/analytics.mjs');
      const { recommend } = await import('/stack-finder/core.mjs');
      const result = recommend({ primaryJob: 'video', existingTools: [],
        frequency: 'daily', budget: 75, biggestPain: 'time' });
      const decision = result.recommendations.find(tool => tool.toolId === 'descript');
      window.probeEvents = [];
      const analytics = createAnalytics({ emit: event => window.probeEvents.push(event) });
      analytics.start();
      const anchor = document.querySelector('#test');
      anchor.href = 'https://example.invalid/fixture-only';
      analytics.bindAffiliateClick(anchor, { toolId: decision.toolId,
        status: decision.status, state: result.state, buyNothing: result.buyNothing,
        approved: true, url: anchor.href }); // Test-only approval, never production.
    });
    await probe.locator('#test').click();
    await probe.waitForFunction(() => window.probeEvents.length === 2);
    await probe.evaluate(() => document.querySelector('#test')
      .addEventListener('click', event => event.preventDefault()));
    await probe.locator('#test').click();
    await probe.waitForTimeout(50); // Let the deferred cancellation check run.
    const events = await probe.evaluate(() => window.probeEvents);
    if (events.length !== 2 || events[1].event !== 'outbound_affiliate_click') {
      throw new Error('Expected one start and one uncanceled outbound action');
    }
    return events;
  } finally {
    await probe.close();
  }
}
```
