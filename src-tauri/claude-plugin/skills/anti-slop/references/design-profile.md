# Interface design profile

Review the interface against its user task, content, context, and current implementation. Aesthetic defaults can be useful when they fit. Do not prescribe one font, palette, card count, density, navigation shape, or visual style for every product.

For every visual design review, also use [visual-style.md](visual-style.md) to inspect palette roles, typography, surfaces, and style fit. Apply D04 and the shared framework’s economy principle to interface labels and explanations: repair grouping or hierarchy before adding copy, while preserving necessary labels and conditions.

For a requested browser walkthrough, use [browser-audit.md](browser-audit.md) within the execution contract. Actually visit and operate the scoped UI; source inspection and static screenshots supplement the walk, not replace it. Ordinary UI review can remain bounded to the containing task.

## Review order: rendered design, then interaction evidence

Stage 2 preparation is governed by [domain-research.md](domain-research.md); use its app-level and bounded-work distinction. Judge this app against its supported user task and [finding-evidence.md](finding-evidence.md).

1. **Inspect the rendered composition.** For a viewable UI, open the existing preview or inspect current supplied captures at their recorded sizes. Follow the browser reference's endpoint/environment rules when opening a preview. A source-only review must state that visual inspection is incomplete; working handlers or clean copy do not establish good design. An ordinary UI audit can use a bounded render inspection without becoming an exhaustive browser walkthrough.
2. **Review whole screen → regions → components → related screens** using the lenses below. Identify the supported job and decision first. Inspect full-page content as well as the initial viewport when available; a full-page thumbnail alone is insufficient for typography or control craft.
3. **Check truth and interaction.** Confirm real content/provenance, labels, destinations, outcomes, and reachable states. In revise mode, remove fabricated proof and never invent a replacement (D05, D06, D22); in audit mode, report it and leave the source unchanged. Keep behavior and accessibility evidence separate from visual judgment.
4. **Synthesize and challenge the findings.** Rank actual issues by supported impact. For each candidate, check the product rationale and a plausible reason to retain it. Retain warnings that still have a concrete task or brief basis; discard unsupported preferences. Do not stop the design review merely because the controls work or the neutral style is intentional.

### Review ledger: make coverage and decisions inspectable

For an app-level design audit, keep a compact ledger of the scoped rendered **screen × viewport × material state** combinations. Include revealed panels/dialogs; visiting a route is not reviewing its composition. Use the actual supplied/captured states, not invented states or every possible permutation. A bounded component review needs only its relevant row(s).

Each row records the screen/evidence, current user decision, and the following five relationship checks. Use the deeper lenses below as needed:

| Check | Required observation |
| --- | --- |
| **Priority** | Identify the strongest visual emphasis and the information/action needed for the current decision. Compare their weight/position. Present/readable status is not necessarily appropriately prioritized. |
| **Association** | Follow a control or heading through its name, explanation, state, and action. Describe their actual proximity/alignment; check whether a user can treat them as one group. Semantic labeling and visual association answer different questions. |
| **Redundancy** | Compare simultaneously visible regions for repeated information. Identify the distinct work of secondary labels, subtitles, helper text, and repeated data, or explain the competing work they create. Prefer layout to copy that merely explains an obvious arrangement. Real records can still be presented redundantly; necessary summary, orientation, and detail links can be useful. |
| **Style and color** | Inspect palette roles, competing accents, typography/surfaces, and fit to the actual brief. Record a specific relationship or an evidence gap; “neutral,” “colorful,” or “on brand” alone is insufficient. |
| **Fit and craft** | Check content at the tested size: wrapping, order, shared edges, component alignment, pane/overlay space and important-state visibility. No horizontal overflow alone does not establish a sound composition. |

For **each check**, record `concern`, `adequate`, `unknown`, or `not applicable`, plus a short concrete observation. “Looks clean,” “consistent neutral styling,” and “buttons work” are not evidence for an adequate association/priority judgment. An adequate judgment can be brief, such as “field name, input, and hint share a left edge.” These are observable review notes, not a request to expose private reasoning.

**Association needs geometry before a verdict.** For a composite control with explanatory text, explicitly record (a) whether the control is beside, above, or below its name, (b) whether the name and explanation share a text edge or use different axes, and (c) the visible spacing/boundary that groups them. Inspect a representative of repeated controls plus material exceptions. Use the image and available rendered bounds/styles; source adjacency or a valid HTML label cannot establish this visual relationship. If the geometry is unavailable, use `unknown`, not “the label and help are grouped.”

Then judge that observed arrangement against the decision. A checkbox centered above its name while a long scope explanation starts at another edge, repeated across several choices, can fragment comparison of the choices and their conditions; assess this as a grouping concern unless actual grouping cues resolve it. Preserve the explanatory conditions in a repair. Conversely, names above inputs with hints on their shared edge, a switch aligned with its setting row, or a clearly bounded centered single-choice composition can be adequate. Different alignment or scrolling alone is not a defect. This check tests association, not a universal requirement for left-aligned or single-line forms.

Keep the ledger in a task-owned audit artifact when file output is appropriate; otherwise use compact report rows. Do not put generated audit files into product source by default. Link or summarize the actual ledger in delivery so an omitted state cannot silently receive a clean verdict. Respect an explicitly requested output format: summarize coverage and material gaps within it rather than appending a second report.

### Reconcile before ranking

1. Review all scoped rows before selecting highlights. A first valid issue or a minor wording issue is not a stopping condition.
2. Account for every `concern`: include it as a finding, merge it with the same underlying issue, or retain a short dismissal with its **specific** task/evidence rationale. Unknown evidence stays a gap. For an important unknown, reinspect the available state once when useful; stop and disclose a real access limit rather than looping or inventing a failure.
3. For each retained issue, use a stable identity: **screen/state + region + mechanism**. One grouping problem across several labels is one issue with multiple examples. Do not compare audits by report-local numbering or exact phrasing, and do not duplicate it as typography, spacing, and UX findings.
4. Rank by supported consequence: a hidden/misrepresented decision or unavailable required action first; a recurring priority/association/redundancy/style burden next; minor finish last. Name the supported consequence; a sensitive screen alone does not make a visual concern a severe defect. Do not bury a meaningful grouping issue beneath optional truncation polish or fill a required issue count.

“It follows the neutral design system,” “the control works,” or “the records are real” cannot alone dismiss a different observed relationship. Preserve the useful design choice while repairing the specific friction when possible. Conversely, no finding is required when the relationships fit the task. Design interpretation remains a heuristic judgment, not proof that users failed.

Use the product guide to constrain repairs, not as a substitute for looking at composition. Inspect broad composition before zooming into individual labels; a punch list of minor truncations must not substitute for screen-level judgment. Intentional ellipsis is often legitimate: flag it only when the observed loss affects needed identification or meaning, checking available context and disclosure rather than treating every clipped title as a failure.

## Visual review lenses

Apply each relevant lens within the selected scope and place the resulting observations in the relationship ledger above. This is review coverage, not a score or a required finding count; the report can summarize the ledger without reproducing the whole worksheet.

| Lens | What to inspect at rendered size |
| --- | --- |
| Task hierarchy | Compare the visual weight and placement of the current decision, primary action, attention-needed state, background status, and identity/decoration. Name the competing elements and how the reading path serves or obstructs the supported job. |
| Grouping and information order | Check proximity and alignment between a control, its label, help, and state; relationships among sections and parent/child records; duplication across simultaneously visible regions. Repeated actual records are legitimate, but their presentation can still obscure which information needs attention. |
| Density and space | Inspect how content, panels, and vertical rhythm use the available width/height. Flag space only when it separates related items, buries needed content, or gives secondary material disproportionate weight. A sparse settings page or comfortable reading space is not inherently a problem. |
| Typography and legibility | Compare actual roles: heading, body, metadata, critical state, control. Check emphasis, line length, wrapping, language fit, and whether important information has become visually secondary. Small text alone is not a failure; a contrast-conformance claim requires the applicable measurement. |
| Component craft | Inspect shared edges, baselines, padding, control/label association, icon/text balance, and long-content behavior. Identify the specific inconsistent relationship rather than prescribing a universal spacing scale or corner radius. |
| Product and system coherence | Compare related components/screens with the actual design guide, assets, and user tasks. Distinguish useful familiar patterns from an interchangeable composition that fails this content. Preserve meaningful identity assets and intentional visual language; neutrality alone does not imply slop. |
| Viewport and state composition | Compare the same important content at the tested widths and relevant open-panel/dialog states. No horizontal overflow does not prove a good mobile reading order, priority, or grouping. State clearly which combinations were inspected. |

Before a no-finding conclusion on UI design, finish the relevant visual lenses or state the remaining visual gaps. Report a compact visual assessment separately from behavioral verification. An accessibility checklist and a list of working buttons cannot substitute for composition, hierarchy, and craft review.

## Findings

Use [finding-evidence.md](finding-evidence.md) for class, severity, deduplication, and evidence limits. A visual warning records **actual screen/region → observed relationship → supported task/brief → likely mechanism → minimal repair**. Functional success does not establish visual quality; an unmeasured interpretation is not a measured user outcome. Use a fitting D rule or report-local VD category for composition, style, and color concerns.

## Implementation checks

- Resize and test actual layouts. WCAG 2.2 reflow guidance calls for content to remain available without two-dimensional scrolling at the specified equivalent width; inspect wrapping and zoom instead of hiding evidence. Do not use overflow-x: clip to conceal content that does not fit.
- Evaluate WCAG contrast using the applicable WCAG method and criteria. APCA can inform design exploration, but it is not interchangeable with a WCAG conformance ratio or an equal pass condition.
- Let controls wrap when language, width, and usability require it. Do not force every button onto one line.
- Give interactive elements accessible names and visible keyboard focus; preserve semantic HTML and a usable tab order. Check touch target, motion, and error behavior in context rather than turning a one-size threshold into an unrequested redesign.
- Use real data. A blank chart may be an empty state; label it honestly. Do not create decorative metrics, fake customer marks, or fabricated testimonials to fill a layout.

## Copy through the interaction

Follow the task from entry to action to result. Keep a stable noun for each object and a stable verb for each operation (D25); prose synonym variety can confuse navigation. Preserve domain terms the audience uses. Name material consequences at decisions, especially deletion, payment, or access changes, only after checking actual behavior (D10).

State copy should tell users the known outcome and the real action available next (D11). Distinguish no results, first use, permissions, and failure when those states exist. Do not invent an error cause, retry path, response deadline, support promise, or progress percentage. A short success message is sufficient for a routine completed action.

Check persistent form labels, helpful validation near its field, and complete messages that translators can reorder. Use actual long names, variables, plural forms, and localized strings when checking fit (D20). Keep visible and accessible names consistent with the action (D14). Do not replace useful instructions with shorter but ambiguous copy.

## Evidence boundary

State what you inspected: source, screenshot, live control, viewport, or measured value. A screenshot can establish visible clipping, not an inert button or keyboard failure. Source can show a missing handler, but an untested runtime outcome remains unverified.

If using a scanner already available for the task, report its actual output as candidates and inspect them in context. CSS coverage can be incomplete when styling is external or injected; disclose that limit. A token match, scanner score, or passing static check cannot establish a usability or WCAG result. Never run a styling fixer merely to satisfy a taste heuristic, especially in audit mode.

