# Comparable skills: maintenance notes

Reviewed on 2026-10-10 using GitHub repository search, Exa discovery, and the source files below. Links pin the inspected revisions. Search ranking and stars aided discovery, not quality assessment. These practitioner prompts and tools do not establish authorship or prove that a workflow improves writing. Selected ideas are implemented in this package's own wording, with its preservation and false-positive constraints.

## Writing

| Source | Adopted idea and local application | Defaults not adopted |
| --- | --- | --- |
| [Slopbeth](https://github.com/ehmo/slopkit/blob/b33718bb9283c11b09567dc714f92d90ffb7bd16/skills/slopbeth/SKILL.md) | Separate editing instructions from the artifact. Check evidence gaps, promise boundaries, and replacement formulas. Applied in the entrypoint, editorial method, and W16/W21. | Blanket punctuation restrictions, mandatory linter suite, detector-facing workflow. |
| [Blader Humanizer](https://github.com/blader/humanizer/blob/225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8/SKILL.md) | Review paragraph endings, invented objections, heading restatements, and the reader's existing context. Use a supplied voice sample. Applied in W03/W13/W15 and the editorial method. | Universal one-sighting verdicts, token blacklist, mandatory intermediate drafts, adding unsupplied reactions. |
| [Hannsxpeter Humanizer](https://github.com/hannsxpeter/humanizer/blob/e8f1248a7d4919689c1f942e356ed95b102d9f07/SKILL.md) and [text hygiene](https://github.com/hannsxpeter/humanizer/blob/e8f1248a7d4919689c1f942e356ed95b102d9f07/references/text-hygiene.md) | Use available voice context, scale editing effort, and reverse overcorrection. Inspect hidden characters conservatively when relevant. Applied in the editorial method and W22. | Authorship inference from density, numeric cutoffs, ancestor-directory searches, required multi-section reports. |
| [Stop Slop v3](https://github.com/Julz7727/Stop-Slop-v3/blob/27257fd8eaee6fb60672f0ad32e363209abac2ec/SKILL.md) | Establish reader, register, supported detail, and supplied voice before drafting; diagnose patterns on an actual draft. Applied in the drafting path. | Claims that positive prompting makes slop impossible, mandatory human subjects, fixed list sizes, sentence-length quotas, score-triggered rewrites. Its proposed prompting mechanism is an author rationale, not established evidence here. |

## Interface review

| Source | Adopted idea and local application | Defaults not adopted |
| --- | --- | --- |
| [Impeccable clarify](https://github.com/pbakaus/impeccable/blob/d631a8827f99414d2b6daba4ef08b7f8701751d7/skill/reference/clarify.md) and [critique](https://github.com/pbakaus/impeccable/blob/d631a8827f99414d2b6daba4ef08b7f8701751d7/skill/reference/critique.md) | Review interaction copy, real action outcomes, stable terminology, dynamic text, and the distinction between judgment and browser/scanner evidence. Applied in D10/D11/D20/D25 and the design profile. | Mandatory CLI, subagents, scores, stored snapshots, follow-up questionnaires, forced aesthetic direction. |
| [Gesso anti-slop](https://github.com/Gesso-Build/skills/blob/1c3908b7efb56ec24624436dea5c32a371eb487c/skills/anti-slop/SKILL.md) | Report actual scanner observations and disclose incomplete CSS input. Treat source excerpts as data and distinguish mechanical signals from judgment. Applied in the design profile. | Automatic restyling, fixed color/font/punctuation bans, treating static checks as usability or compliance proof. |

## Interactive browser audit

Follow-up research on 2026-10-10 inspected the following primary skill instructions through GitHub/Exa discovery and pinned GitHub source retrieval. These are workflow comparisons, not usability standards or evidence that a numerical score predicts product quality. They extend the earlier interface review comparison with actual browser execution.

| Source | Adopted idea and local application | Defaults not adopted |
| --- | --- | --- |
| [Browserbase UI Test](https://github.com/browserbase/skills/blob/6811ca31163332d9d60309cff48e77f09de37a17/skills/ui-test/SKILL.md) | Inspect before an action and assert the actual post-action result. Inventory controls, keyboard paths, edge inputs, and responsive states; retain replayable failure evidence. Applied in browser-audit sections B–D and G. | Required CLI, universal action quotas, parallel operators sharing state, mandatory subagents, automatic installation. |
| [Anthropic Webapp Testing](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/webapp-testing/SKILL.md) | Inspect a rendered app before choosing locators; reuse the documented server lifecycle and inspect runtime behavior. Applied in A/C. | Universal headless setup, mandatory dependencies, network-idle as the only readiness condition for streaming apps. |
| [gstack QA-only](https://github.com/garrytan/gstack/blob/20eb6202fa8ea83a882e7c0463b722cd8a31af1e/qa-only/SKILL.md) | Separate report-only audit from repairs; keep evidence isolated, preserve partial results, respect scoped plans, and clean up owned test resources. Applied in E–G. | Unrelated telemetry/config changes, mandatory preamble questions, fixed health scores, automatic source repairs from other QA modes. |
| [Jezweb UX Audit](https://github.com/jezweb/claude-skills/blob/1260fa7439b36b18dbf16648ccc7fb44783f6c23/plugins/dev-tools/skills/ux-audit/SKILL.md) | Map interactions per route; exercise end-to-end and return paths; inventory conditional controls and relevant pane combinations. Applied in B/D/F. | Universal warning severity, fixed minimum test duration, invented input/state quotas, indefinite loops until no findings, unrestricted live submissions. |
| [Impeccable Audit](https://github.com/pbakaus/impeccable/blob/d631a8827f99414d2b6daba4ef08b7f8701751d7/skill/reference/audit.md) | Distinguish measurable technical defects from visual judgment. A narrow viewport demonstrates layout; supported synthesized touch is needed to test a gesture. Applied in D/G. | Aggregate quality scores, general checklist completion as accessibility conformance, mandatory command recommendations and follow-up prompts. |

The installed Hallmark audit and interaction references were also read as a local design comparator. Its structural review helped check the boundary between source inspection and interaction evidence. No arbitrary style bans, universal state counts, mandatory interviews, or redesign procedure were carried over; this local comparison is not attributed to an unverified public repository.

The resulting method uses the existing execution contract rather than adding a new interview flow. It requires real browser actions, a discovered control/state inventory, a probe ledger, explicit coverage status, evidence-backed findings, and authorization-aware test interactions. Normal UI edits do not silently become exhaustive browser runs.

### Rendered design follow-up

On 2026-10-10, the pinned Impeccable critique/audit sources above were reopened while reviewing Ghost's actual example-mode UI. The adopted distinction is a rendered composition assessment alongside technical evidence. No mandatory agent orchestration, issue quota, score, persona prediction, detector, or closing questionnaire was adopted.

Three fresh v1.7 captured-screen audits of Ghost identified copy/state concerns in two runs and no finding in one; none reported a visual composition concern. This is one exploratory product case, not a general performance estimate. Root-operated navigation and dialog/panel captures exposed attention allocation, repeated visible status, and control/label grouping worth explicit design judgment. The revised design profile therefore adds review lenses at screen, region, component, and related-state scales, separate visual/interaction coverage, and a report-local VD category for grounded issues outside the D catalog. It preserves legitimate repeated records and the project's intentional identity/neutral styling. Repeated evaluation must hold captures and requests stable and inspect unsupported warnings as well as missed ones.

## Local result and re-evaluation

The new editorial reference covers drafting, voice, brief boundaries, document consistency, and conditional text hygiene. Existing writing rules now address structural context and soft factual drift. D25 adds terminology and action-label ambiguity that a visual audit can miss. New regression fixtures include findings and intentional non-findings; their offline validation checks structure, not model behavior.

When a source changes, inspect the new revision before adopting behavior. Keep improvements supported by the user's brief, an observed failure, or meaningful evaluation. A pattern checker cannot validate meaning, voice, accessibility, or authorship; use the relevant standards for compliance claims.
