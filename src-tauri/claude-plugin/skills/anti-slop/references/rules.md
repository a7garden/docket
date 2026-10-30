# Canonical anti-slop rules

Framework alignment reviewed 2026-10-22; individual sources retain their checked dates. The rules are editing prompts, not a classifier. Severity describes the impact if the observed condition is real; confidence describes whether the signal proves it. Do not turn a heuristic or preference into a hard failure. The classes are language-agnostic; examples mix Korean and English, and language profiles supply register-specific cautions.

## Finding classes

[Finding and evidence policy](finding-evidence.md) owns classification, conditional severity, and one-primary-rule deduplication. Apply review guardrails such as D18/D24 to your own method; report them only when that method or a review/brief is itself the target.

- **확실한 오류 / error:** evidence shows a false claim, contradictory fact, broken task, or applicable conformance failure. Correct only after checking the relevant source, code, or rendered behavior.
- **휴리스틱 경고 / warning:** a pattern can make prose or UI generic, inflated, repetitive, or harder to use. A pattern alone never proves AI authorship or poor quality.
- **취향 제안 / preference:** an optional alternative in tone, rhythm, composition, or visual style. Never block or silently rewrite a sound choice.

Severity: **high** = can mislead, block a task, or violate a concrete requirement; **medium** = meaningful clarity/usability cost; **low** = polish opportunity. “Automatic” means mechanical pre-screening only; no rule can establish AI origin.

## Evidence registry

Each rule cites one or more IDs below; the source URL and checked date apply to every cited rule.

- **S01 — Hallmark slop test**, practitioner design heuristics, not a universal conformance checklist: https://github.com/Nutlope/hallmark/blob/main/skills/hallmark/references/slop-test.md (checked 2026-10-07).
- **S02 — Wikipedia signs of AI writing**, an editorial advice page, not proof or a validated detector; its October 2026 catalog adds vague association, canned notability emphasis, and tacked-on superficial analysis as common signs: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (checked 2026-10-08).
- **S03 — JMLA title study**, a limited comparison of 50 medical-journal article titles; the supplied report describes colon use in its ChatGPT-4.0 sample as 100% and human sample as 30%. This is not a rule for Korean prose or all titles: https://jmla.pitt.edu/ojs/jmla/article/view/2266 (checked 2026-10-07).
- **S04 — Anthropic frontend-design skill**, a design direction against generic interfaces: https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md (checked 2026-10-07).
- **S05 — Impeccable**, a practitioner toolkit for UI critique and craft; recommendations still need context: https://github.com/pbakaus/impeccable (checked 2026-10-07).
- **S06 — Spot the Slop: a UI designer's guide**, practitioner observations rather than a formal standard: https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c (checked 2026-10-07).
- **S07 — W3C WCAG 2.2 Reflow**, informative explanation of the applicable criterion, not a mandate for one visual layout: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html (checked 2026-10-07).
- **S08 — Oh My Pi extension guide**, checked against locally installed omp 18.8.0 and the official current guide: https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md (checked 2026-10-07).
- **S09 — W3C WCAG 2.2 Contrast (Minimum)**, informative explanation of SC 1.4.3 and the applicable ratio: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html (checked 2026-10-07).
- **S10 — W3C WCAG 2.2 Keyboard**, informative explanation of keyboard operability: https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html (checked 2026-10-07).
- **S11 — W3C WCAG 2.2 Focus Visible**, informative explanation of visible focus: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html (checked 2026-10-07).
- **S12 — W3C WCAG 2.2 Pause, Stop, Hide**, informative explanation of applicable moving/auto-updating content: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html (checked 2026-10-07).
- **S13 — W3C WCAG 2.2 Animation from Interactions**, informative explanation of motion reduction for interaction-triggered animation: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html (checked 2026-10-07).
- **S14 — Excess-vocabulary study**, a corpus-level comparison of LLM-assisted and human biomedical abstracts; lexical overrepresentation describes populations of texts, not authorship of one document: https://arxiv.org/abs/2406.07016 (checked 2026-10-08).
- **S15 — Measuring AI "Slop" in Text**, an expert-interview taxonomy with span-level annotation; binary slop judgments are subjective but correlate with coherence and relevance: https://arxiv.org/abs/2509.19163 (checked 2026-10-08).
- **S16 — sloptells measured-tell catalog**, frequency comparisons against matched human corpora with published retirements and negative results; tells are model-, version-, and register-specific and drift as models change: https://sloptells.com/ (checked 2026-10-08).
- **S17 — Korean model-voice comparison**, a practitioner observation of recurring Korean prose habits across three assistant families; the author notes variation by model version and system prompt: https://brunch.co.kr/@webtutor/1157 (checked 2026-10-08).
- **S18 — AI design slop analysis**, a practitioner account of same-stack interface defaults (purple gradients, glass surfaces, identical card grids, interchangeable hero copy) adopted without a product reason: https://smoothui.dev/blog/ai-design-slop (checked 2026-10-08).

- **S19 — Slopbeth workflow**, practitioner guidance on brief/artifact separation, evidence boundaries, and commitments: https://github.com/ehmo/slopkit/blob/b33718bb9283c11b09567dc714f92d90ffb7bd16/skills/slopbeth/SKILL.md (checked 2026-10-10).
- **S20 — Blader Humanizer**, practitioner examples of structural repetition, invented objections, and reader-context mismatch; its stronger token restrictions are not adopted: https://github.com/blader/humanizer/blob/225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8/SKILL.md (checked 2026-10-10).
- **S21 — Hannsxpeter Humanizer text hygiene**, practitioner guidance on preserving meaningful Unicode, not authorship evidence: https://github.com/hannsxpeter/humanizer/blob/e8f1248a7d4919689c1f942e356ed95b102d9f07/references/text-hygiene.md (checked 2026-10-10).
- **S22 — Impeccable clarify**, practitioner guidance on action outcomes, terminology, state copy, and localization; not a conformance standard: https://github.com/pbakaus/impeccable/blob/d631a8827f99414d2b6daba4ef08b7f8701751d7/skill/reference/clarify.md (checked 2026-10-10).

For the wider comparison and rejected defaults, see [skill-comparison.md](skill-comparison.md). External skills provide editorial examples, not an empirical detector or automatic repair authority.

## Writing

### W01 — Empty, repeated, or overgrown headings and subtitles
- **Scope:** titles, subtitles, headings, section labels.
- **Basis:** S01, S02 (2026-10-07).
- **Detect:** multiple headings announce the same point; a subtitle merely repeats the title; a heading has no content beneath it; headings outnumber useful sections.
- **Repair:** remove duplicates or make a heading carry information the title does not.
- **Exceptions:** a title/subtitle pair may serve distinct search, audience, or editorial functions; a short section can be intentional.
- **Class/severity:** warning / medium; error only for a broken outline or a materially misleading heading.
- **Automatic:** partial; empty sections and repeated strings can be listed, usefulness requires a reader.

### W02 — Colon in title treated as an automatic tell
- **Scope:** headlines, paper titles, product headings.
- **Basis:** S03 (2026-10-07; its sample is limited to medical-journal titles).
- **Detect:** a colon is repeated by habit or introduces a vague slogan rather than a useful relation.
- **Repair:** keep it if the second phrase narrows, explains, or usefully frames the first; otherwise try a direct title and compare.
- **Exceptions:** subtitles, formal titles, lists, and genres with a colon convention. One colon is not evidence of AI writing.
- **Class/severity:** preference / low, unless a title misleads.
- **Automatic:** no meaningful decision; punctuation counts alone are not findings.

### W03 — Repeated contrast or invented objection
- **Scope:** “A가 아니다, B다”, “not X but Y”, and passages that stage an alternative only to reject it.
- **Basis:** S01, S02, S20 (2026-10-10).
- **Detect:** the same reversal cadence manufactures emphasis without adding a distinction; or the passage invents an objection, weaker option, or defense that the audience has no reason to consider. Check split sentences and adjacent paragraphs too.
- **Repair:** state the supported positive claim; retain contrasts or objections that explain an actual decision or resolve a relevant misconception.
- **Exceptions:** a precise correction, genuine trade-off, teaching example, FAQ misconception, or deliberate rhetorical antithesis can be effective; absence of a quoted opponent alone is not a finding.
- **Class/severity:** warning / low to medium, depending on repetition.
- **Automatic:** partial; pattern search can flag candidates, not judge purpose.

### W04 — Mechanical three-part list
- **Scope:** slogans, paragraph conclusions, repeated feature lists.
- **Basis:** S01, S02 (2026-10-07).
- **Detect:** an exactly three-part cadence is repeated or the items are padded, parallel abstractions with no independent content.
- **Repair:** keep the items that carry information; choose the count that matches the facts.
- **Exceptions:** three real steps, dimensions, examples, or a deliberate rhetorical triad.
- **Class/severity:** warning / low.
- **Automatic:** partial; counting list items cannot establish padding.

### W05 — Significance inflated beyond the facts
- **Scope:** claims that a local result “changes the paradigm,” “opens a new dimension,” or is “the essence/core” without explaining a concrete consequence.
- **Basis:** S02, S16 and user-supplied examples (2026-10-08).
- **Detect:** grand significance is asserted without a named change, scope, evidence, or consequence; or a reframe (“진짜 질문은”, “~의 핵심은”, “본질은 ~에 있다”) declares profundity instead of showing it.
- **Repair:** say what happened and what follows; retain the importance claim only with its support and scope.
- **Exceptions:** the terms themselves are valid in technical, quoted, or well-supported contexts.
- **Class/severity:** warning / medium; error if the claim is demonstrably false or misleading.
- **Automatic:** no; keyword matches would overflag.

### W06 — Vague authority or unclear causal link
- **Scope:** phrases such as “experts say,” “studies show,” “is known,” “in relation to,” or “as a result” without an identifiable source or relation.
- **Basis:** S02 (2026-10-08).
- **Detect:** readers cannot tell who said what, which evidence applies, or whether the text claims causation, correlation, or mere timing; a relationship is only gestured at (“~와 연관된”, “~의 일환으로”, “연계된”) where the actual role, date, or action could be stated.
- **Repair:** name the source and scope from supplied evidence, qualify the relation, or remove the unsupported attribution.
- **Exceptions:** a broad summary can be acceptable when its sources are cited nearby and the scope is clear.
- **Class/severity:** warning for observed attribution/relation ambiguity; error only when evidence establishes a false attribution, contradiction, or unsupported causal assertion. Severity follows the demonstrated consequence, not the absence of a source alone.
- **Automatic:** no; source and causal meaning need checking.

### W07 — Promotional modifiers without a concrete claim
- **Scope:** product, institutional, and explanatory prose.
- **Basis:** S02, S04, S05 (2026-10-07).
- **Detect:** stacked praise such as “혁신적이고 강력하며 획기적인” adds no observable capability, result, or reason.
- **Repair:** remove the praise or state the supplied feature/result and its limits.
- **Exceptions:** intentional campaign language may be the requested voice; factual superlatives still need evidence.
- **Class/severity:** warning / low to medium.
- **Automatic:** no; a word list alone is unsafe.

### W08 — Familiarity or fame used as proof
- **Scope:** arguments relying on a famous person, company, publication, or “widely known” status.
- **Basis:** S02 (2026-10-07).
- **Detect:** recognition is presented in place of relevant evidence or an explained expert basis.
- **Repair:** connect the cited person's relevant work to the claim, or provide direct evidence.
- **Exceptions:** fame may itself matter in a passage about influence, reach, or public recognition.
- **Class/severity:** warning / medium; factual misattribution is an error / high.
- **Automatic:** no.

### W09 — Empty challenge, obstacle, or optimistic ending
- **Scope:** conclusions and “what's next” paragraphs.
- **Basis:** S02 (2026-10-07).
- **Detect:** generic “many challenges remain,” “the future is bright,” or “a new era begins” closes the passage without naming an obstacle, condition, or next action.
- **Repair:** state the specific open issue and evidence, or end after the answer.
- **Exceptions:** an explicitly aspirational speech or campaign can keep a hopeful close.
- **Class/severity:** warning / low to medium.
- **Automatic:** no.

### W10 — Repeated bold label plus colon in every bullet
- **Scope:** lists, recaps, email drafts, reports.
- **Basis:** S01, S02 (2026-10-07).
- **Detect:** every bullet starts with a bold generic noun and colon, then restates that label in the sentence.
- **Repair:** keep labels only when they speed scanning or distinguish fields; otherwise use direct bullets or prose.
- **Exceptions:** structured reference lists, data dictionaries, or skimmable summaries may need labels.
- **Class/severity:** warning / low.
- **Automatic:** partial; format is searchable, usefulness is contextual.

### W11 — Punctuation, symbols, and emphasis amplified
- **Scope:** exclamation marks, ellipses, repeated bold, emoji, ornamental glyphs, and excessive parentheses.
- **Basis:** S02, S16 plus user-supplied Korean-specific candidates (2026-10-08).
- **Detect:** emphasis is repeated without changing tone or meaning, symbols interrupt reading, nested asides obscure the main sentence, or a short conversational or social post carries report structure — headers, bullet piles, bold bursts, emoji-as-structure — its medium and length do not need.
- **Repair:** retain one purposeful cue; put essential conditions in the sentence or a clearly scoped note.
- **Exceptions:** quoted source text, chat voice, fiction, math, code, URLs, established notation, and meaningful sequence markers stay intact.
- **Class/severity:** warning / low.
- **Automatic:** partial; counts identify review candidates only.

### W12 — Abstract nouns or coined terms hide the actor and action
- **Scope:** Korean nominal chains and invented compounds.
- **Basis:** S02 and user-supplied Korean profile (2026-10-07).
- **Detect:** several abstract nouns cluster but no one can say who did what or what changed.
- **Repair:** unpack into a concrete subject, verb, object, and supported outcome.
- **Exceptions:** established terminology, domain shorthand, names, or purposeful literary abstraction.
- **Class/severity:** warning / medium.
- **Automatic:** no; do not ban individual terms.

### W13 — Same meaning repeated with synonyms
- **Scope:** neighboring clauses, paragraphs, headings, and summary lines.
- **Basis:** S02, S20 (2026-10-10).
- **Detect:** the same claim is paraphrased for emphasis without adding a condition, example, implication, or distinction; a heading is immediately restated; or each section closes by naming the lesson its example already made clear.
- **Repair:** keep the clearest version and preserve any genuinely new qualification.
- **Exceptions:** a recap may aid navigation or learning when it adds orientation or a useful synthesis.
- **Class/severity:** warning / low to medium.
- **Automatic:** partial; semantic overlap needs judgment.

### W14 — Monotone cadence or low information density
- **Scope:** prose rhythm and consecutive statements.
- **Basis:** S02, S16 and user-supplied candidates (2026-10-08).
- **Detect:** sentences march in one rhythm — near-uniform length, structure, or endings (“~습니다” 단조) — or many short sentences repeat a subject or claim without evidence or development; uniformity, not shortness, is the signal.
- **Repair:** combine related claims, vary the rhythm where it aids reading, or keep only distinct, supported points. Do not insert new facts to make the passage feel substantial.
- **Exceptions:** varied short cadence can create urgency, accessibility, emphasis, or a deliberate voice; length variance is normal.
- **Class/severity:** warning / low to medium.
- **Automatic:** partial; sentence length is measurable, quality is not.

### W15 — Background delays or avoids the answer
- **Scope:** answers, reports, FAQ, support and product copy.
- **Basis:** S02, S20 and user-supplied candidates (2026-10-10).
- **Detect:** general background repeats the question or postpones the requested answer, decision, or instruction; a reply rebuilds context the recipient supplied before reaching its decision.
- **Repair:** lead with the supported answer, then retain evidence or context that changes the reader's understanding or decision. Omit already-shared background only when that shared context is available.
- **Exceptions:** a safety-critical qualification, necessary setup, or standalone document for a new audience may need background first.
- **Class/severity:** warning / medium; error when a required instruction is omitted.
- **Automatic:** no; compare with the user's question and context.

### W16 — Conversational assistant scaffolding remains in a deliverable
- **Scope:** submitted reports, public copy, finished docs.
- **Basis:** S02, S17, S19 (2026-10-10).
- **Detect:** “요청하신 내용을 정리해 보겠습니다”, “아래는 …입니다”, process narration, sycophantic openers (“물론입니다!”, “좋은 질문이네요!”), or formulaic closers (“도움이 되셨길 바랍니다”, “추가로 궁금하신 점은 언제든 말씀해 주세요”) address the requester instead of serving the final reader; editing instructions or internal checklists are printed as if they belong to the artifact.
- **Repair:** apply the brief, remove leaked instructions and process narration, and keep content the final audience needs.
- **Exceptions:** a cover note, email reply, facilitation script, quoted instruction, or explicitly conversational deliverable; determine the artifact boundary before deleting text.
- **Class/severity:** warning / low.
- **Automatic:** partial; exact phrase checks miss context.

### W17 — Placeholder or broken formatting leaks into final copy
- **Scope:** drafts and rendered documents.
- **Basis:** S02 and user-supplied candidates (2026-10-07).
- **Detect:** unresolved TODO/name/date tokens, empty headings, duplicated markers, or a broken link/table/list disrupts the reader.
- **Repair:** fill only from verified material; otherwise mark the gap plainly or remove the unused field.
- **Exceptions:** labeled template fields, redactions, code examples, and explicit editing instructions.
- **Class/severity:** error / high when it misleads or blocks; otherwise warning / medium.
- **Automatic:** partial; search common tokens and validate links/markup, then inspect context.

### W18 — False, unsupported, or mismatched citation
- **Scope:** citations, quotes, references, links, attribution.
- **Basis:** S02 (2026-10-07).
- **Detect:** evidence establishes a fabricated or mismatched reference, a misquotation, a claim the source does not support, or an attribution outside its population/scope. A failed fetch alone does not establish any of these.
- **Repair:** read the source and check its scope; correct the demonstrated mismatch. If authentication, a paywall, network failure, or unavailable material prevents verification, record the access limit and leave support unverified; do not call the citation false or invent a replacement.
- **Exceptions:** explicitly marked placeholders, opinions without factual authority, and inaccessible sources whose validity has not been established either way. Access gaps belong in verification limits unless independent evidence supports a finding.
- **Class/severity:** error / high for a demonstrated citation or support failure; unverified access alone has no defect classification.
- **Automatic:** partial; URL/bibliographic checks are evidence leads, not proof of fabrication. Claim support requires inspecting the source.

### W19 — Unsupported “verified,” “proven,” or completion claim
- **Scope:** statements that checks, tests, studies, or validation succeeded.
- **Basis:** S02 (2026-10-07).
- **Detect:** an agent/editor claims its own verification without actually performing or observing it, strengthens a supplied report into independent proof, or available evidence contradicts the claimed check, scope, or outcome. An existing author's statement is not disproved merely because the reviewer cannot access its records.
- **Repair:** report exactly what was checked and observed; preserve attribution to supplied verification rather than adopting it as your own. Correct demonstrated contradictions. If the underlying record is unavailable, disclose that the source claim remains unverified without recasting it as false.
- **Exceptions:** supplied or attributed verification with no contradictory evidence; preserve its scope and disclose independent-access limits when relevant.
- **Class/severity:** error / high for an invented, contradicted, or overstated verification claim; an access gap alone has no defect classification.
- **Automatic:** no; compare statement to actual evidence.

### W20 — Invented first-person or lived experience
- **Scope:** authorial “I/we,” testimonials, and claims of having used, seen, or tested something.
- **Basis:** S02 (2026-10-07).
- **Detect:** an editor introduces personal experience or testimony absent from the source/author.
- **Repair:** delete it or ask the author for a truthful account; never write a fictional testimonial as fact.
- **Exceptions:** fictional character voice, clearly labeled hypothetical, or first-person experience already supplied by the author or attributed source. Missing independent corroboration does not establish invention.
- **Class/severity:** error / high if represented as fact; otherwise warning.
- **Automatic:** no.

### W21 — Subject, number, time, condition, or commitment drift
- **Scope:** statements across a document and its summary/table.
- **Basis:** user-supplied preservation requirement, S02, S19 (2026-10-10).
- **Detect:** a subject, date, comparison baseline, denominator, uncertainty, tense, or prerequisite changes between passages or between source and rewrite; an edit introduces causality, simultaneity, obligation, or a recovery promise the source did not state.
- **Repair:** reconcile against the source; restore claim strength and promise boundaries, keep exact known values, and flag unresolved differences. Plausibility cannot supply a missing cause or commitment.
- **Exceptions:** a clearly labeled scenario, estimate, forecast, or deliberate change over time.
- **Class/severity:** error / high for demonstrated drift or conflict; warning for an unresolved difference between supplied statements. This classification does not extend detection to any missing contextual detail (such as an unstated year) without an evidenced ambiguity affecting the task.
- **Automatic:** partial; tables and repeated entities can be diffed, but equivalence needs checking.

### W22 — Protected literals or sequence markers changed
- **Scope:** code, quotations, math, units, URLs, proper names, identifiers, meaningful sequence, and linguistically meaningful Unicode.
- **Basis:** user-supplied preservation requirement, S21 (2026-10-10).
- **Detect:** a style edit alters a literal, mathematical expression, source quote, route/URL, unit, or actual sequence; broad Unicode cleanup removes joiners, direction controls, variation selectors, or spacing needed for language or display.
- **Repair:** restore the original exact string; edit around it. Verify display escaping without changing stored content. Inspect a suspicious codepoint's role before any targeted cleanup; preserve ambiguous characters.
- **Exceptions:** explicit user instruction to alter the protected material, or a verified correction requested by the user.
- **Class/severity:** error / high.
- **Automatic:** partial; exact diff catches changes but cannot tell whether a change was authorized.

### W23 — Unit, arithmetic, or comparison basis lost
- **Scope:** measurements, currencies, percentages, sample sizes, dates, rankings.
- **Basis:** user-supplied preservation requirement and S03 (2026-10-07; study-scope caution).
- **Detect:** a necessary unit, population, denominator, or comparison baseline is absent from the relevant context; arithmetic does not reconcile; or a narrow study is generalized. Check surrounding headings, labels, and established conventions before declaring information missing.
- **Repair:** retain the source unit and population; recompute only from verified values; state limits.
- **Exceptions:** a clearly labeled hypothetical; meaningful unitless values; units or bases unambiguously established in the surrounding context.
- **Class/severity:** error for demonstrated wrong arithmetic, changed units/basis, or false generalization; warning for an observed interpretive ambiguity. Severity depends on the consequence; a missing label is not automatically high severity.
- **Automatic:** partial; arithmetic and format can be checked, evidentiary scope needs a reader.

### W24 — Opening and ending repeat instead of advancing
- **Scope:** essays, explanations, proposals, announcements.
- **Basis:** S02 and user-supplied candidates (2026-10-07).
- **Detect:** the conclusion restates the title and opening without a consequence, answer, decision, or synthesis.
- **Repair:** remove the repeated sentence or make the ending state the grounded implication or next step.
- **Exceptions:** a deliberate refrain, summary for reference, or genre convention.
- **Class/severity:** warning / low.
- **Automatic:** partial; text similarity can identify candidates, not purpose.

### W25 — Table used where no comparison exists
- **Scope:** prose and short lists reformatted as tables.
- **Basis:** user-supplied candidate (2026-10-07).
- **Detect:** columns repeat the same kind of sentence and add no stable dimensions for scanning or comparison.
- **Repair:** use prose or a list; keep a table when the reader benefits from row/column alignment.
- **Exceptions:** data, schedules, feature comparisons, and reference fields.
- **Class/severity:** preference / low.
- **Automatic:** no.

### W26 — Title or subtitle promises the wrong content
- **Scope:** heading-to-body relationship.
- **Basis:** S01, S02 (2026-10-07).
- **Detect:** a dramatic or concrete heading implies a claim, number, result, or scope the body does not support.
- **Repair:** align the label to the actual content or add the missing supported content.
- **Exceptions:** metaphor and wordplay are fine when the audience can understand the relation.
- **Class/severity:** error / high when materially misleading; otherwise warning.
- **Automatic:** no.

### W27 — Interpretation appended without evidence
- **Scope:** factual sentences and report paragraphs.
- **Basis:** S02 (2026-10-08).
- **Detect:** facts are repeatedly closed by an interpretive tail — “이는 ~을 보여 준다”, “~을 강조한다”, “~의 함의가 크다” — that adds significance the surrounding text does not support.
- **Repair:** keep the fact and delete the tail, or add the analysis the claim requires (evidence, mechanism, source).
- **Exceptions:** a supported conclusion in an analysis section; a summary that restates evidence already given.
- **Class/severity:** warning / medium; error when the tail asserts a false relationship.
- **Automatic:** no; support must be checked against the text.

### W28 — Qualifier and disclaimer density erases information
- **Scope:** claims, advice, safety notes, and disclaimers across a deliverable.
- **Basis:** S16, S17 (2026-10-08).
- **Detect:** nearly every sentence carries a hedge (“~일 수 있습니다”, “~로 알려져 있습니다”, “~하는 경우가 많습니다”), or one disclaimer repeats several times; after the hedges, no testable claim remains.
- **Repair:** keep one honest qualifier where uncertainty is real, state the actual evidence, and keep a required disclosure once where it applies.
- **Exceptions:** regulated medical, financial, or legal notices, and deliberate uncertainty that must be preserved (see W21).
- **Class/severity:** warning / medium; removing a required disclosure is an error.
- **Automatic:** no; density versus domain need is judged in context.

### W29 — Calqued or imported phrasing replaces plain wording
- **Scope:** vocabulary and metaphors in prose and copy, any language.
- **Basis:** S14, S16, S17 (2026-10-08).
- **Detect:** imported imagery and calques pile up — Korean “풍부한 태피스트리”, “인생의 여정”, “깊이 파헤쳐 봅시다”; English “a rich tapestry of”, “your journey with us”, “unlock the power of” — or register-elevated words (“활용하다”, “culinary”, “leverage”, “bespoke”) replace the plain term the audience uses.
- **Repair:** rewrite with the plain, established term in the text's language or the concrete claim; keep a metaphor only when it earns its place.
- **Exceptions:** established loanwords and technical terms, quoted text, deliberate code-switching, a stated campaign voice.
- **Class/severity:** warning / low to medium.
- **Automatic:** no; a word list alone cannot judge register fit.

## Interface design

### D01 — Repeated cards flatten different information
- **Scope:** feature grids, dashboards, landing pages, lists.
- **Basis:** S01, S04, S05, S06 (2026-10-07).
- **Detect:** distinct content is forced into same-size cards with identical icon/title/paragraph structure and no scanning or task benefit.
- **Repair:** group, list, compare, or vary only where hierarchy and content justify it.
- **Exceptions:** actual repeated records or comparable features often benefit from consistent cards.
- **Class/severity:** warning / medium.
- **Automatic:** partial; count repetition, then inspect content and task.

### D02 — Gradient or glow used as default decoration
- **Scope:** surfaces, hero backgrounds, buttons, illustrations.
- **Basis:** S01, S04, S05, S06 (2026-10-07).
- **Detect:** gradients compete with text, repeat across unrelated sections, or have no brand, data, depth, or interaction purpose.
- **Repair:** keep purposeful color; reduce area or contrast only when the actual hierarchy/readability suffers.
- **Exceptions:** an intentional brand field, meaningful state, or restrained atmosphere can work.
- **Class/severity:** warning / low; contrast/readability failures are errors.
- **Automatic:** partial; CSS can find gradients, not judge purpose.

### D03 — Badges and pills multiply without semantic work
- **Scope:** tags, eyebrow labels, status chips, feature labels.
- **Basis:** S01, S05, S06 (2026-10-07).
- **Detect:** decorative pills repeat the adjacent heading or imply a status, category, or validation that does not exist.
- **Repair:** remove decorative labels; retain concise, accurate status/category text when it improves scanning.
- **Exceptions:** filters, status, taxonomy, and interactive chips with clear behavior.
- **Class/severity:** warning / low; false state is an error.
- **Automatic:** partial.

### D04 — Interface headings, labels, or explanations do redundant work
- **Scope:** hero, section titles, secondary labels, subtitles, helper text, and page outline.
- **Basis:** S01, S04, S05 (2026-10-07), and the owner's AGENTS.md economy constraint (2026-10-22).
- **Detect:** a secondary label, subtitle, or explanation repeats the nearby heading/control or explains an arrangement already clear from layout, without adding needed context; or the heading outline misrepresents structure. Identify the actual redundant content and its surrounding arrangement.
- **Repair:** remove or merge redundant copy; use placement, grouping, and hierarchy to communicate the relationship before adding explanation. Match semantic headings to the outline.
- **Exceptions:** persistent field labels, accessible names, units, scope/eligibility, safety conditions, recovery, and genuinely useful orientation. Layout does not replace necessary content. A visually large heading need not be an H1 if semantics are correct.
- **Class/severity:** warning / medium; semantic outline failure may be an error.
- **Automatic:** partial; inspect DOM and content.

### D05 — Fabricated testimonial, logo, or customer proof
- **Scope:** marketing and product proof blocks.
- **Basis:** S01, S04, S05 (2026-10-07).
- **Detect:** evidence establishes an invented or misattributed testimonial, customer mark, endorsement, or usage claim, or use outside a known consent/context boundary. Missing or inaccessible provenance alone does not establish fabrication or missing permission.
- **Repair:** remove the demonstrated misrepresentation, use verified authorized evidence, or clearly label an illustrative example. For unavailable provenance, report the verification gap without inventing a replacement or assuming permission.
- **Exceptions:** supplied authorized content and clearly labeled fictional examples; unverified provenance without independent evidence of misrepresentation remains a verification limit.
- **Class/severity:** error / high for demonstrated misrepresentation or unauthorized use; an access gap alone has no defect classification.
- **Automatic:** no; provenance review is required.

### D06 — Invented statistic or decorative chart
- **Scope:** metric bars, counters, charts, progress visuals.
- **Basis:** S01, S04, S05 (2026-10-07).
- **Detect:** values are fabricated, chart encodings have no data, axes/units/baselines are missing, or numbers are chosen only to fill a layout.
- **Repair:** use verified data with labels and scope, show an honest empty state, or remove the chart.
- **Exceptions:** a clearly labeled illustrative example, synthetic test fixture, or fictional interface.
- **Class/severity:** error / high for misrepresented real data.
- **Automatic:** partial; data and labels can be extracted, provenance needs evidence.

### D07 — Image or illustration is unrelated or falsely evidentiary
- **Scope:** hero art, product screenshots, photography, generated images.
- **Basis:** S01, S04, S05, S06 (2026-10-07).
- **Detect:** image adds no relevant context, depicts a product state that does not exist, or is mistaken for genuine evidence.
- **Repair:** remove it or use a relevant, authorized asset; label illustration when confusion is likely.
- **Exceptions:** decorative art can set mood when it does not obscure content and is accessible.
- **Class/severity:** warning / medium; false product evidence is error / high.
- **Automatic:** no.

### D08 — Decoration or secondary identity outranks the user's task
- **Scope:** visual hierarchy, motion, ornament, secondary brand/profile identity, hero elements.
- **Basis:** S01, S04, S05, S06 (2026-10-07).
- **Detect:** ornament, a secondary brand/profile identity region, dramatic typography, animation, badges, or art takes greater visual emphasis than the primary information/control without serving the current task. A functional identity panel can still be secondary; compare its actual role and emphasis with the supported decision.
- **Repair:** reduce or relocate only the competing element; keep necessary whitespace and brand character.
- **Exceptions:** art-directed work may intentionally lead with visual expression.
- **Class/severity:** warning / medium.
- **Automatic:** no; judge at rendered sizes.

### D09 — Interchangeable hero/feature/CTA page rhythm
- **Scope:** page macrostructure.
- **Basis:** S01, S04, S05, S06, S18 (2026-10-08).
- **Detect:** a landing-page template is repeated despite different content and user journeys, leaving each section with generic copy and no distinct role; or the same stack defaults recur across unrelated products — one font, purple gradient, glass surfaces, identical card grids, interchangeable hero copy — without a product reason.
- **Repair:** derive section order from the information and task; do not invent sections to create variety.
- **Exceptions:** a familiar sequence is acceptable when it suits the audience and reduces navigation cost.
- **Class/severity:** warning / medium.
- **Automatic:** no.

### D10 — Control looks interactive but does nothing or misleads
- **Scope:** buttons, links, toggles, menus, forms.
- **Basis:** S01, S04, S05, S06, S22 (2026-10-10).
- **Detect:** activation has no effect, destination is placeholder, visible affordance disagrees with behavior, or label overpromises the action or hides a material consequence.
- **Repair:** wire the actual action and truthful label, including a verified consequence when it changes the user's decision, or render non-interactive content as such.
- **Exceptions:** prototype controls may be inactive only when the prototype status is obvious.
- **Class/severity:** error / high.
- **Automatic:** partial; route and click checks help, but expected outcome needs context.

### D11 — Missing task-critical interaction state
- **Scope:** loading, empty, error, success, disabled, selected, validation.
- **Basis:** S01, S04, S05, S06, S22 (2026-10-10).
- **Detect:** the user cannot tell what happened, how to recover, why an action is unavailable, or what to do with no results; vague state copy hides the known failure or available recovery.
- **Repair:** state the known outcome and actual next action; preserve visible progress when work is pending. Do not invent a cause, completion time, support commitment, progress value, or retry option the system does not provide.
- **Exceptions:** no need to invent states irrelevant to the component or unreachable in its contract.
- **Class/severity:** error / high when task is blocked; otherwise warning.
- **Automatic:** partial; exercise documented states or inspect component coverage.

### D12 — Content clipped or unavailable at narrow width/zoom
- **Scope:** responsive layout, page overflow, fixed-width elements.
- **Basis:** S07 (2026-10-07).
- **Detect:** at applicable viewport/zoom, content or operation is cut off or requires two-dimensional scrolling contrary to the relevant reflow criterion.
- **Repair:** fix width, wrapping, grid, or component behavior and retest. Do not hide a real overflow with overflow-x: clip.
- **Exceptions:** content that inherently needs two-dimensional layout, such as a large data table, can use a clearly bounded accessible alternative under WCAG guidance.
- **Class/severity:** error / high after reproduction.
- **Automatic:** partial; viewport checks find overflow but need manual inspection and applicable exceptions.

### D13 — Button text forced onto one line
- **Scope:** controls across languages, widths, and zoom.
- **Basis:** S07 and user-supplied constraint (2026-10-07).
- **Detect:** nowrap or fixed sizing clips, overlaps, or creates horizontal scroll as labels grow or viewport narrows.
- **Repair:** permit wrapping, reflow the control group, or give adequate space while keeping the action understandable.
- **Exceptions:** a short label may remain single-line if tested and fully visible at supported sizes.
- **Class/severity:** error if clipped; otherwise preference.
- **Automatic:** partial; inspect computed width and rendered result.

### D14 — Keyboard focus, accessible name, or semantics missing
- **Scope:** interactive controls, custom widgets, icon-only buttons.
- **Basis:** S01, S04, S05, S07, S10, S11 (2026-10-07).
- **Detect:** keyboard users cannot reach/operate a control, focus is invisible, or an assistive technology receives no accurate name/role/state.
- **Repair:** prefer native elements; add correct label/role/state only where needed and verify keyboard sequence.
- **Exceptions:** decorative art may be hidden from assistive technology; visual focus can vary as long as it remains clear and usable.
- **Class/severity:** error / high after testing.
- **Automatic:** partial; static accessibility checks are incomplete.

### D15 — Contrast claim uses the wrong success criterion
- **Scope:** text, controls, focus indicators, graphical objects.
- **Basis:** S09 and user-supplied constraint (2026-10-07).
- **Detect:** a WCAG conformance claim is based only on APCA, or a contrast failure is asserted from a token name or visual guess without calculating the applicable WCAG ratio.
- **Repair:** measure against the relevant WCAG criterion and actual background; use APCA only as optional design analysis, not an equivalent pass.
- **Exceptions:** APCA may be used for internal design exploration if no WCAG conformance claim is made.
- **Class/severity:** error / high for a false compliance claim; otherwise preference.
- **Automatic:** partial; a contrast tool can calculate supplied pairs, but backgrounds and criteria need verification.

### D16 — Motion or auto-rotation blocks access
- **Scope:** animation, carousels, moving banners, reduced-motion.
- **Basis:** S04, S05, S12, S13 and applicable WCAG guidance (2026-10-07).
- **Detect:** motion ignores reduced-motion preference or automatically moving content cannot be paused when the criterion applies.
- **Repair:** provide a reduced-motion alternative and usable pause/stop control for applicable auto-updating content.
- **Exceptions:** brief, essential feedback animation may not need a separate control when criteria do not apply; do not remove useful state feedback.
- **Class/severity:** error / high when an applicable requirement fails; otherwise warning.
- **Automatic:** partial; media queries and controls can be searched, runtime behavior must be tested.

### D17 — Emoji or icon substitutes for meaningful content
- **Scope:** feature, action, step, status, and navigation symbols.
- **Basis:** S01, S04, S06 and user-supplied constraint (2026-10-07).
- **Detect:** decorative glyph is the only label, meaning varies by platform, or a symbol implies status/action the UI does not support.
- **Repair:** use visible text or a consistent accessible icon with a name; remove a symbol that adds no information.
- **Exceptions:** intentional emoji in informal content; decorative glyph hidden from assistive tech when adjacent text carries meaning.
- **Class/severity:** warning / medium; inaccessible or false control meaning is error.
- **Automatic:** partial; scan emoji and icon-only controls, then inspect semantics.

### D18 — Fixed style quota replaces context
- **Scope:** typography, palette, cards, spacing, and component counts.
- **Basis:** S04, S05, S06 (2026-10-07; practitioner guidance).
- **Detect:** a design review demands a particular font, color, number of cards, or fixed density without a brief, brand, content, platform, or access reason.
- **Repair:** evaluate fit, hierarchy, legibility, and existing product conventions; offer alternatives as options.
- **Exceptions:** an actual design system, platform rule, or explicit brand constraint is authoritative.
- **Class/severity:** preference / low; not a defect in the artifact itself.
- **Automatic:** no.

### D19 — Navigation or footer copied as generic chrome
- **Scope:** site navigation and footers.
- **Basis:** S01, S04, S05, S06 (2026-10-07).
- **Detect:** links/columns/social marks are included by template despite being irrelevant, duplicating other navigation or obscuring the real destinations.
- **Repair:** include only useful, real destinations and match the site's information architecture.
- **Exceptions:** familiar nav/footer forms can be efficient and appropriate, especially for large sites.
- **Class/severity:** warning / low to medium.
- **Automatic:** no.

### D20 — Visual language fails the real content or device
- **Scope:** color, type, density, hit areas, layout across target devices.
- **Basis:** S04, S05, S07, S09, S10, S11, S22 and user-supplied constraint (2026-10-10).
- **Detect:** tested language/zoom/device makes labels wrap badly, controls collide, hierarchy vanish, or required content disappear.
- **Repair:** adapt the component and retest real copy, including Korean strings, long names, localized messages, dynamic values, and zoom. Preserve variables and allow translators to reorder complete messages.
- **Exceptions:** breakpoints and densities depend on actual usage; do not enforce one viewport or hit-area style without the product context.
- **Class/severity:** error / high for a reproduced task/access failure; otherwise warning.
- **Automatic:** partial; responsive screenshots and DOM checks help, but inspect behavior.

### D21 — Chart or table hides units, categories, or scope
- **Scope:** data visualization and tabular comparison.
- **Basis:** user-supplied preservation constraint and S01 (2026-10-07).
- **Detect:** axes, units, dates, missing-data status, or comparison baseline are absent or change the apparent claim.
- **Repair:** label values and scope; retain an honest empty/unavailable state; use prose where no data comparison exists.
- **Exceptions:** a deliberately schematic diagram clearly labeled as such.
- **Class/severity:** error / high if readers can infer a false result; otherwise warning.
- **Automatic:** partial; check labels and data, then verify interpretation.

### D22 — Product screenshot or demo claims unsupported behavior
- **Scope:** screenshots, mockups, demos, synthetic UI content.
- **Basis:** S01, S04, S05 (2026-10-07).
- **Detect:** a visual is presented as an actual product state or workflow that does not exist or was not provided.
- **Repair:** use a verified capture or label a mockup as illustrative; remove invented feature states.
- **Exceptions:** fictional or conceptual prototypes clearly labeled.
- **Class/severity:** error / high when presented as real evidence.
- **Automatic:** no; confirm asset provenance and live product behavior.

### D23 — Content order serves the template, not the user task
- **Scope:** section order, dashboard priority, form flow.
- **Basis:** S04, S05, S06 (2026-10-07).
- **Detect:** generic intro or repeated benefit blocks push the requested answer/action below decorative content, or headings do not match what follows.
- **Repair:** order real information by user task; remove unsupported sections instead of inventing content for symmetry.
- **Exceptions:** storytelling and editorial pacing may defer the answer by design.
- **Class/severity:** warning / medium; misleading hierarchy can be error.
- **Automatic:** no.

### D24 — Taste is reported as a functional or standards defect
- **Scope:** any design review.
- **Basis:** S01, S04, S05, S06, S07, S09, S10, S11 (2026-10-07).
- **Detect:** “too many cards,” centered layout, gradient, typeface, whitespace, or color is labeled a failure without a user-task, measured, brand, or accessibility reason.
- **Repair:** label it as an optional direction and name the effect it might improve; leave the viable choice intact.
- **Exceptions:** a style choice can become a real defect when evidence shows clipping, low contrast, confusion, or task friction.
- **Class/severity:** classify the target review's unsupported claim under the shared evidence policy; the underlying viable visual choice remains optional taste and is not a product defect.
- **Automatic:** no; this rule is a reviewer discipline.

### D25 — Terminology or action labels obscure the outcome
- **Scope:** navigation, forms, confirmations, and state copy across an interaction.
- **Basis:** S22 (2026-10-10; practitioner guidance).
- **Detect:** the same object or action receives interchangeable names with no distinction, one term refers to different concepts, or a generic action label leaves a consequential outcome unclear from its surrounding context.
- **Repair:** use the established product term consistently and name the actual action or consequence where needed. Inspect the destination or handler before claiming its outcome; do not rename a domain term just to simplify vocabulary.
- **Exceptions:** deliberate domain distinctions, documented aliases, localization inflection, and a short generic label with unambiguous surrounding context.
- **Class/severity:** warning / medium; error only when verified behavior contradicts the label or users cannot determine a task-critical consequence.
- **Automatic:** partial; string comparisons find candidates, semantic equivalence and actual outcomes need context.

## Evidence scope and maintenance

Rule-level suggestions to ask for evidence are repair options, not permission to initiate an interview. The [execution contract](execution-contract.md) governs whether an essential clarification is needed; embedded use preserves or reports gaps within its containing task.

The cited anti-pattern pages provide examples and opinions, not an empirical method to identify model authorship. Wikipedia's page is advice, not detector validation. The JMLA result concerns a small medical-title comparison and does not establish a colon rule for Korean or other writing. W3C guidance supports checking applicable reflow behavior; it does not prescribe a visual theme. Recheck sources before making new compliance claims, and revise a rule only when the source, product context, or observed false-positive cases justify it.

Tells also drift. Corpus-level lexical studies describe populations of texts, not one document's author (S14); expert annotators disagree on binary slop judgments (S15); and measured catalogs retire or reverse signals as models change — “delve” and “tapestry” largely disappeared, short-sentence cadence was refuted in favor of uniform cadence, and single marks such as the em dash are unreliable evidence (S16). Korean assistant habits likewise vary by model version and system prompt (S17). Re-check a signal's currency before acting on a word, symbol, or structure; the rules here target reader-serving quality, never authorship attribution.
