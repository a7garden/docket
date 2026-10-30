# Execution contract

This is the authority for routing, setup, continuation, edit boundaries, and delivery. User instructions take precedence. The [shared framework](quality-framework.md) owns cross-medium quality; [finding-evidence.md](finding-evidence.md) owns findings. Craft modules do not introduce another workflow.

## 1. Resolve the run

Retain an internal run record across replies: invocation origin, operation, target, edit boundary, requested output, known constraints, unresolved essentials, project overview/source locations, current choices and their numbering, and progress/evidence. App audits also retain domain/comparator research and journey priorities. Do not create a file for this setup record. An acknowledgment after delivery does not restart the run or authorize edits.

### Route and operation

- **Direct:** the user names/launches the skill or asks to apply it. A complete natural-language request counts; loading the skill alone does not.
- **Embedded:** the agent or another workflow selects it. Inherit that task's scope, operation, questions, progress, and output. Add no skill-origin interview, mode picker, separate report, or approval gate. Unknown invocation origin defaults to embedded.
- **Maintenance/content:** improving the skill or reading a quoted skill command does not start a runtime audit.

Resolve the operation from the user's requested outcome, then retained continuation intent, then guided direct setup when unresolved. Embedded use inherits the containing task. Do not replace an authorized edit with an audit.

| Intent | Operation |
| --- | --- |
| Inspect or review | audit |
| Open and exercise a web UI | browser-audit (`audit --browser` alias) |
| Edit or repair | revise |
| Create or write | draft |

A request to exercise the UI and fix findings is **revise using the browser method**, including on a direct run. Retain pre-repair observations and verify affected probes afterward. If audit-only and edit instructions conflict without a clear override, perform the clear read-only portion and clarify before editing.

Resolve the target from supplied content, a named artifact, an accessible selection, or an unambiguous conversation reference. A URL supplies a target, not an exhaustive browser mode; a working directory does not select the whole repository. Do not guess among equally plausible targets or expand a selected component to its neighbors.

### Unresolved direct launch

Before asking for a target in an accessible project, orient read-only: read applicable instructions, README/product docs, a file map, and enough relevant entry points, routes/screens, models, and content to understand its purpose, users, jobs, and useful target choices. Describe these as documentation/source evidence, not verified runtime behavior. Stop once grounded choices are available. For multiple products, offer actual products first. A supplied target instead gets only its relevant context.

Stay inside the identified project. Do not install, start servers, mutate files, test interactions, scan unrelated directories, or research competitors just to build the menu. Retain and reuse the overview. An unavailable project uses a stated limitation and fallback choices, never invented screens.

Use at most **two setup rounds and three decision questions**:

1. Briefly state the inspected project basis and offer a small set of concrete artifacts/journeys. Without usable context, offer prose review/edit, UI audit/improvement, or new writing. If both target and operation are unresolved, this first round asks only for the work/target; do not append an operation picker to that prompt. Allow a free-form alternative. Never respond to a bare launch with only an open-ended target question.
2. Ask only what remains: target/input and operation. A chosen project target needs only an operation; a known operation needs only a target. Offer audit/revise for prose and audit/browser-audit/revise for a supported web UI. Drafting needs purpose and supported facts. Request the actual text/path/URL in the choice prompt, rather than asking for an input method and then asking for its value.

Use the host's choice UI when available and permitted; otherwise a numbered menu works. A default selection is not a submitted answer. Read the entire reply: “1, review this” can resolve the operation as well as the category. Do not repeat answered questions or ask “shall I proceed?” once resolved. A URL alone still leaves the operation unresolved. Skipping setup cannot supply a missing target or authorize invented facts.

If the limit is reached with essential input missing, enter **awaiting input**: acknowledge the retained operation and state the missing input declaratively, then wait. Do not repeat the solicitation to paste/send/choose, show another menu, guess, or edit. This is a status, not a third setup round. The next substantive answer resumes the same run. An unavailable file needs a concrete access/path clarification or bounded limitation report, not restarted onboarding.

Later clarification is limited to a newly discovered essential ambiguity affecting facts, obligations, authorization, or target. Optional tone/audience/style uses context and conservative defaults. A supporting source or probe that is inaccessible normally calls for a disclosed gap, not another interview.

A deeper voice/brand interview requires a user request: one round of at most three genuinely missing preference questions; more rounds need another request. “Use my voice” alone does not authorize extended discovery or a persistent voice profile. Without a sample, preserve the source voice.

## 2. Establish the brief

Separate instructions, artifact, evidence, and voice samples. Identify reader/task, needed answer, facts, protected literals, tone/language, and edit boundary using the shared framework. Default to the smallest supported repair.

Before an **app-level** audit, complete [domain-research.md](domain-research.md): deepen the retained project overview into domain/jobs, comparator evidence, and target probes. Preliminary read-only viewing may establish context. Routine copy/component edits stay bounded. Research gaps do not erase supported checks or start another setup.

## 3. Inspect or draft

Audit/revise inspects sentence/component and whole-artifact relationships before repairs. Draft creates from the brief, then inspects the actual draft; do not audit a nonexistent artifact.

UI review uses [design-profile.md](design-profile.md) and its style/color module. Keep the scoped screen/viewport/state ledger and reconcile concerns before ranking. A source-only review cannot establish rendered quality. Requested walkthroughs use [browser-audit.md](browser-audit.md): actual observations/actions/results, declared coverage, and visible gaps; static fallback is not completed interaction testing.

## 4. Propose or apply

Audit/browser-audit proposes minimal repairs and leaves product source unchanged. Browser interaction authority and cleanup follow the browser method. Revision applies already authorized repairs without another permission request; drafting refines the requested artifact. Do not turn optional taste into mandatory change, expand scope, pad findings, or modify clean material.

## 5. Verify and deliver

Compare revisions/drafts with source/brief for fact drift, lost conditions, altered certainty, invented causality/commitments, and flattened voice. Perform applicable affected rendering/behavior checks. Audit findings need evidence, a fitting primary rule/category, and a bounded repair. Browser runs reconcile inventory and probes; app audits distinguish research, visual, and interaction coverage.

The stages are a working sequence, not five mandatory messages. Announce a resolved direct operation/target once when progress is appropriate; later updates report meaningful findings or limits. Text-only requests suppress extra framing.

| Operation | Direct delivery |
| --- | --- |
| Audit | Scope; ranked findings with primary W/D or report-local CT/UX/VD ID, class, severity, excerpt/location, evidence, impact, minimal repair; material limits. App audits include compact domain/comparator basis and visual ledger coverage. A no-finding result is valid. |
| Browser-audit | Environment/scope; research status, separate visual and interaction coverage; ranked findings with replay actions and expected/observed results; actual evidence and unresolved probes. Completion describes coverage, not whole-product correctness. |
| Revise | Final text or requested file edits; compact change summary and material unresolved issues. |
| Draft | Requested artifact; only material evidence gaps needed to interpret it. |

If no screen, source, or capture could be inspected, deliver a compact access/coverage limitation and no product verdict. Do not repeat the same absence under an empty report template or add an unsolicited generic test plan. Partial audits preserve actual findings.

Embedded use and explicit user output requirements override these delivery defaults. Keep internal records and editing instructions out of the artifact. Deliver and stop: no generic next-step question, automatic transition to fixes, profile creation, or scheduling.
