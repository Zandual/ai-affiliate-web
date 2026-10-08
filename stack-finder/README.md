# Stack Finder preview and UI verification

M7.2 mounts the five-question Finder alongside the existing site. The UI uses the
M7.1 engine for decisions. The scenarios below are reproducible browser checks;
the completed verification is recorded at the end of this guide.

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

The existing Expo app may request `/api/products` and receive a 404 in this static
preview because its legacy API is unavailable. The Finder runs independently of
that endpoint.

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
- Analytics wiring is outside M7.2 and belongs to M7.3. This guide does not claim
  conversion tracking, live affiliate activation, or production deployment.

## Verification performed — October 8, 2026

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
