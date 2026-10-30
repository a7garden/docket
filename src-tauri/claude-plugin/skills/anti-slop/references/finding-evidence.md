# Finding categories and evidence

This reference owns finding identity, classification, severity, and evidence limits. The execution contract owns delivery; the shared framework owns preservation and economy. Categories do not expand the user's scope.

## One issue, one primary rule

Choose a matching canonical W01–W29 or D01–D25 rule as primary when one fits its detection conditions and exceptions. Use a report-local ID only when no canonical rule fits; do not put a local ID first with a fitting canonical ID in parentheses. W21 covers demonstrated drift or conflicts, not every missing contextual detail. A hypothetical need for an unstated year is not a W21 finding.

Identify an issue by **location/state + mechanism + consequence**, not by the number of matching rules. Select the most specific applicable rule as primary; cite other rules as related when useful, without creating duplicate findings. If independent mechanisms need different repairs, they may be separate issues. Apply the same identity when comparing repeated runs.

Useful overlap boundaries:

| Overlap | Primary rule |
| --- | --- |
| W13 / D04 | D04 for redundant visible UI labels, subtitles, and helper explanations; W13 for prose repetition outside that interface structure. |
| D08 / VD | D08 when decoration or secondary identity visibly outranks the task; VD for other observed composition/style mechanisms outside the catalog. |
| W01 / W13 / W24 | W01 for redundant heading structure; W24 for a repeated opening/ending; W13 for other semantic repetition. |
| W18 / W21 / W23 | W18 for source/claim mismatch; W23 for numeric basis or arithmetic; W21 for other source/result or cross-passage drift. |
| D07 / D22 | D22 for a product screenshot/demo falsely presented as real; D07 for other image relevance or representation problems. |
| D10 / D25 | D10 for verified behavior contradicting an affordance/label; D25 for inconsistent terminology or contextual ambiguity. |
| D18 / D24 | D18 for an arbitrary style mandate; D24 for presenting taste as a functional/standards defect. These review guardrails do not themselves establish a defect in the product. |

Outside the catalog, use a report-local category rather than stretching a canonical rule:

| Category | Required basis |
| --- | --- |
| **CT-01**, etc. — content | An observed factual, reasoning, relevance, or necessary-content problem in prose. State the excerpt, supported purpose/requirement or inspected evidence, consequence, and minimal repair. An omitted requirement needs a real brief or task basis, not an imagined audience need. |
| **UX-01**, etc. — domain UX | A supported user job, requirement or visible promise, affected journey, observed friction, and minimal repair. A competitor feature alone is not a target requirement. |
| **VD-01**, etc. — visual design | The actual screen/region/capture, observed composition, style or color relationship, task/design-brief basis, likely effect, and minimal repair. |

These IDs belong to the report, not the canonical catalog. For example, a verified false standalone fact without an attribution need not be forced into W18; a required scheduling workflow with observed overlap-checking friction can use UX; a palette that undermines a declared action hierarchy can use VD.

A broad domain task alone does not establish that a particular field, proof document, feature, or explanatory label is required. For a missing-information finding, cite the target-specific requirement/visible promise or show the actual ambiguity that prevents the supported decision. A screenshot's absent information and a separate identity region do not establish hidden workflow requirements or that person's role. If the connection is unknown, record a gap rather than adding a requirement or inventing a role in the repair.

Before delivery, reconcile every retained issue with the overlap table: identify its mechanism, check the applicable canonical detection/exception, and choose one primary ID. In particular, decoration or secondary identity outweighing the task maps to D08; redundant visible UI explanation maps to D04. Reserve VD for a different mechanism outside those rules. This is a classification check, not permission to invent findings or rewrite their evidence to fit an ID.

## Evidence class and severity are independent

- **Error:** direct evidence establishes a false claim, contradiction, broken behavior, violated target requirement, or applicable measured standards failure.
- **Warning:** observed contextual evidence supports a likely clarity, reasoning, UX, or visual-fit problem. Explain the mechanism as judgment; do not claim measured user outcomes.
- **Preference:** an optional alternative when the existing choice remains sound. Do not present it as a required repair.
- **Unverified gap:** missing access, binding, observation, or measurement. It has no defect class or severity; record it in verification limits.

Choose severity only after establishing the class: **high** for a supported material misrepresentation, blocked core task, or concrete consequential requirement failure; **medium** for meaningful understanding/decision cost; **low** for limited local friction or polish. Rule-level severities are conditional guides, not automatic scores. An error can be low impact; a grounded warning can concern a consequential decision. Preferences remain optional regardless of prominence.

A visual warning does not require a broken control or a user study. A real control/label separation, unnecessary explanation, conflicting color role, or misplaced emphasis needs an observed relationship and task/brief basis. Overall intentional style or working controls cannot dismiss it. Aesthetic dislike and another app's different palette supply no such basis.

## Evidence limits

Unavailable citation records, testimonial provenance, or measurement logs do not establish fabrication or absent permission. Do not adopt a supplied author's verification as your own. Correct a proven mismatch; otherwise preserve attribution and report the relevant gap. An agent's own claim of checking something requires actual execution/observation.

A concern that depends on an unobserved binding or behavior remains a hypothesis/probe. For example, confirmation copy found in source without a known screen binding cannot establish misleading registration copy. An icon-only screenshot cannot establish the absence of an accessible name. Keep these gaps visible instead of inventing warnings or outcomes.

Name the evidence kind: supplied requirement, inspected source, documented behavior, rendered observation, operated interaction, or measurement. A screenshot cannot prove persistence; a help page cannot prove clicks. For an accessibility claim identify the criterion, level, applicability, and actual measurement/observation; a few probes cannot establish product-wide conformance.

Each finding needs a location/excerpt, evidence, consequence, and one minimal repair. Browser findings also need replay actions and expected/observed results; visual findings describe the observed relationship without inventing a failed action. Keep material limits in compact reports and permit no-finding results.
