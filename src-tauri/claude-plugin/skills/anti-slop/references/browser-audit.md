# Browser audit

Use for `browser-audit <target>`, `audit --browser <target>`, or a request to open and exercise the UI screen by screen. This is a detailed interaction audit of the scoped web UI. It follows the execution contract's five stages and question policy. The walkthrough itself leaves product source unchanged and does not initiate an interview. A containing workflow with an explicit repair request can use this inspection method, then apply its already authorized revisions and verify them; preserve the original failed probes alongside repair verification.

## Before A. Domain and UX research

Stage 2 uses [domain-research.md](domain-research.md), which owns preparation and research status. Complete it before the systematic walkthrough; preliminary read-only opening may identify the target.

## A. Open the real target

Resolve the URL or web preview from the request, project documentation, or an already running development server. If a local UI has no running server, use its documented existing development/preview command when allowed. Record the process you start and how to stop it. Do not install a new testing stack, migrate databases, deploy, seed real accounts, or rebuild a native UI as a website just to make the audit possible.

Prefer the host's interactive browser tool; follow its actual documentation and session rules. A browser CLI or Playwright runner already available is also suitable. An HTTP reader, HTML dump, or screenshot viewer alone is not an interactive browser. Do not invent unsupported browser APIs or silently substitute a fresh unauthenticated session for a required logged-in one.

Open the provided or discovered endpoint and verify that actual page content renders. HTTP 200 can still contain a build-error overlay. Wait for a specific visible readiness condition with a bounded timeout; do not rely universally on network-idle, which streaming apps may never reach. Observe loading before waiting for the completed state when possible.

Record the tested URL/route, environment (local/staging/production), browser/engine if known, session/role if relevant, and actual viewport. Use available authorized login state; do not request credentials in chat or copy cookies. If authentication, server access, or a browser capability blocks a probe, record the concrete limitation and continue independent accessible checks.

If the target is prose or a native interface with no web preview, mark browser-audit **not applicable** and explain why; do not silently relabel a source review as browser testing. If a web target cannot be opened interactively, mark coverage **blocked**. A supplemental static review can still be useful, but label it separately.

## B. Map screens, controls, and journeys

Build a coverage ledger before acting, using the domain/UX brief to prioritize core and recovery journeys, then extend it as menus, dialogs, routes, and conditional fields appear. Include all distinct in-scope reachable screens, important user journeys, and actionable controls. The selected target sets the boundary: an isolated modal does not authorize auditing the entire product. Tie expected outcomes to this app's contract and supported user task; a comparator feature alone does not establish an expected result.

For each screen, inventory navigation, buttons, menus, forms, filters, sorting, pagination, tabs, dialogs/drawers, and expand/collapse controls that actually exist. Note relevant states and expected outcomes from visible copy, the user brief, or the product contract. Do not create states that the component cannot have.

Also keep the screen/state relationship ledger under [design-profile.md](design-profile.md): priority, association, redundancy, style/color, and fit/craft, with actual observations and decisions. Capture and inspect the rendered state at readable size. A control ledger measures interaction coverage; it does not establish visual quality. Revisit composition when a panel, modal, or narrow viewport materially changes the reading order. Reconcile visual concerns before selecting report highlights; keep unreviewed visual states separate from passed interaction probes.

Walk from the entry point through a meaningful end-to-end journey, then sweep controls and edge paths not covered by that journey. On a broad request, visit each distinct reachable in-scope screen; a homepage and top few links are only a smoke test. Repeated data rows can share a control implementation: record representative samples and distinct conditions instead of claiming every row was tested. Exclude out-of-scope external destinations explicitly.

Use one browser operator for a stateful journey. Do not interleave concurrent clicks in the same session. Preserve the route, current state, completed probes, pending probes, and evidence across interruptions; resume rather than start discovery again.

## C. Execute the loop for each probe

1. **Observe:** inspect the current rendered screen and available semantic/DOM snapshot. Record the route, control, precondition, and expected result before the action. Ground the locator in the current browser observation; after a transition, inspect again rather than reusing stale references.
2. **Act:** actually click, type, select, scroll, hover, or use the keyboard through the browser. Exercise one meaningful transition at a time. A source handler, element count, screenshot, or DOM script that forces the desired state is not proof that the user action works.
3. **Verify:** inspect the new screen/state after the appropriate wait. Check the expected outcome: destination, selected state, validation message, dialog opening/closing, list change, or completed operation. A dispatched click is not itself a passing result. UI success text alone does not establish durable backend persistence; use reload/revisit or available recorded evidence when the contract requires persistence.
4. **Record:** append the action and actual result immediately. Capture the important before/after states and a failure screenshot when the tool supports it. Retain the actual screenshot path or tool evidence reference. If an evidence capability is unavailable, state that rather than inventing a file.

Reuse a baseline only when it still represents the current state. Take a fresh observation after navigation, modal changes, async completion, and other meaningful transitions. Long runs can keep the ledger and evidence in a task-owned output location; preserve prior reports and keep generated audit artifacts out of product source by default. Redact credentials and private values in evidence.

## D. Detailed checks

Apply these to existing controls and reachable states, not as a universal widget quota:

| Area | Exercise and verify |
| --- | --- |
| Navigation | Every distinct in-scope destination; active location; back/forward and round trips where relevant; unexpected loss of task context. |
| Menus, tabs, disclosures | Open, select, close, repeated opening, selected/expanded state; newly revealed controls; outside dismissal and keyboard behavior where the component promises them. |
| Dialogs and drawers | Open from the real trigger; useful initial focus; keyboard containment when modal; Escape/cancel/close; return of focus; content scrolling; a reopened dialog's actual state. |
| Forms | Persistent labels; empty, invalid, and valid test inputs where authorized; field-specific recovery; whitespace, long names, localized text, and documented limits; whether submit state and resulting copy agree with behavior. |
| Lists and data views | Search/filter/sort and clear; no-results recovery; pagination boundaries; detail → back; units, scope, missing data; representative repeated-row actions with explicit sample coverage. |
| Async operations | Actual pending/disabled/success/error behavior when reachable; duplicate activation only where safe; recovery after a genuine or documented test failure. Do not invent a retry action or progress percentage. |
| Keyboard and semantics | Tab through the actual journey; visible focus and logical order; activate native controls with appropriate keys; open/close overlays; compare visible labels with accessible names and state when tools expose them. |
| Responsive layout | Inspect the same important screens/states at a desktop and a narrow viewport relevant to the product; actual dimensions, long content, wrapping, overflow, sticky/overlay interactions, and pane combinations that affect the task. Add intermediate widths when a breakpoint is suspect. |
| Visual composition | Review task priority, grouping, unnecessary labels/explanations, density, typography, palette roles, style fit, shared alignment, and control/label relationships in the current state. Compare important desktop/narrow and open/closed-panel states; use the design profile's evidence-backed lenses, not a style blacklist. |
| Themes, zoom, motion | Exercise existing theme controls; use browser-supported zoom/reduced-motion settings where applicable; retain state feedback. Record settings actually exercised and those not available. |
| Runtime evidence | If exposed by the browser, inspect action-related console/network evidence; correlate errors with the reproduced failure. An unrelated warning or expected error response is not automatically a product defect. |

A narrowed viewport verifies responsive rendering; it does not prove touch gestures, a physical device, or a different browser engine. Use actual supported touch/drag input to verify a gesture, or mark it untested. Likewise, axe/static checks supplement keyboard and visual inspection; they do not establish full accessibility conformance. Contrast findings need the applicable criterion and measured colors/background, not an image-based guess.

For focus containment, verify whether keyboard input reaches background page controls. A native dialog may allow focus to visit browser chrome; a DOM snapshot with no active page control alone does not prove a keyboard escape defect. Record an inconclusive observation when the tool cannot expose the destination, and check return/continued Tab behavior before judging it.

Trigger empty/error/loading states through the UI or documented preview/test controls when available. Do not edit source, corrupt user data, bypass auth, or monkeypatch runtime state to manufacture evidence. Mark an unreachable or unsafe-to-trigger state as blocked/not-run, not as a missing product state.

## E. Interaction authority and cleanup

Audit leaves product source unchanged, but browser actions can affect data. Reuse existing task authorization; do not request approval for each ordinary navigation, filter, or reversible local interaction. Use synthetic data and an identified disposable test environment for persistent submit/create/edit/delete probes. Ownership and isolation must be known, not inferred from `localhost` alone.

If a control would publish, pay, delete real data, send to another person, or otherwise exceed the authorized test scope, stop before that action and record the affected probe as blocked. Existing explicit authorization can cover it; otherwise use the containing task's approval policy only if completing that action is necessary. Do not turn the gate into a general interview. Inspect the pre-action UI and continue other probes meanwhile.

Existing authorization does not override a host/tool requirement for action-time confirmation or user handoff. Apply that requirement at the specific action, while retaining the rest of the audit's progress and evidence.

Reset only test state owned by this run through known safe mechanisms. Close only audit-owned tabs and stop only processes started for this audit unless the user wants them retained. Do not kill shared servers, log the user out, or erase their drafts. Cleanup failures and unintended side effects belong in the report.

## F. Ledger and completion

Each probe records: ID; screen/route; control or state; viewport; precondition; actual action/input; expected result; observed result; status; evidence reference; and any exclusion/block reason. Keep enough detail to replay a finding. These fields may be a table or structured records; never fabricate timestamps, measurements, screenshots, or a performed action.

Probe statuses:

- **pass:** the actual executed probe produced its expected result, with evidence.
- **fail:** the actual executed probe reproduced a supported problem, with evidence.
- **inconclusive:** an action ran, but available evidence cannot establish its outcome. Record the attempted action and the missing observation; do not count it as a pass or defect.
- **blocked:** a specific access, capability, authorization, or environment condition prevented execution of the probe.
- **not-run:** an inventoried applicable probe was not executed; explain the remaining gap.
- **not-applicable:** the check does not apply to this screen/control; state why.

Coverage status is separate from product findings:

- **completed:** every applicable probe in the declared inventory has a conclusive recorded outcome (pass/fail). Failures can exist in a completed audit. A static page with no controls can complete visual/layout probes without invented interactions.
- **partial:** some meaningful probes ran, but applicable inconclusive/blocked/not-run items remain.
- **blocked:** no meaningful interactive/rendered audit could run on an applicable web target.
- **not-applicable:** the target has no web-renderable UI.

Reconcile counts from the ledger: attempted = pass + fail + inconclusive; conclusive = pass + fail. List inconclusive, blocked, not-run, and justified not-applicable separately. Never remove inaccessible controls from the inventory to make coverage look complete. If the scope is sampled or bounded by a user limit, say so; completion refers to that declared scope, not the whole app. Expand for newly discovered controls, and stop when the scoped inventory is accounted for. Do not loop indefinitely until no new opinions emerge.

## G. Deliver

Return tested scope/environment and coverage status, then a concise visual assessment and screen/control/state coverage summary, ranked findings, and remaining gaps. Keep visual inspection coverage distinct from interaction probes. Use [finding-evidence.md](finding-evidence.md) to classify findings. Each includes a primary canonical rule or report-local CT/UX/VD ID, class, and severity, route/region/control, replay steps and inputs, expected → observed result, actual evidence, user impact, and one minimal repair. For a visual warning, the expectation comes from the supported task/brief and the observation is the visible relationship; do not invent a failed action. Label design interpretation as such and suspected code causes as unconfirmed unless verified separately.

Include the compact domain/UX brief, inspected comparable-app sources, the resulting journey priorities, and research status. Keep research gaps separate from browser probe gaps. State which observations belong to the target and which are comparator references; do not present a competitor screenshot or documented flow as a performed test of this app.

Do not turn “no failures observed” into a whole-app pass. Do not switch from audit to fixes or append an approval question by default. Embedded use places this evidence inside the containing task's result rather than adding another report. A requested compact/text-only report still states material coverage limits.

The maintained [skill comparison](skill-comparison.md) records the browser-audit research. The isolated [browser fixture](../tests/browser-audit-fixture.html) provides reusable interaction exercises for skill evaluation; its synthetic behavior is not evidence about any real product.
