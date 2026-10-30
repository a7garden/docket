---
name: anti-slop
description: "Draft, audit, or revise prose and product interfaces for clarity, truth, useful structure, and visual fit. Covers sentences, UI copy, layout, typography, style, color, and interaction while preserving the author's voice and product identity."
metadata:
  version: "2.0.6"
  short-description: "Writing and interface quality framework"
---

# Anti-slop

Improve what readers and users receive. A surface pattern is a review cue, never proof of AI authorship or a reason to change a sound choice.

## Shared contract

Read [quality-framework.md](references/quality-framework.md) and [execution-contract.md](references/execution-contract.md) for runtime use. The former owns cross-medium quality and preservation; the latter owns routing, questions, authorization, continuation, and delivery. Maintenance of the skill is not a runtime invocation.

Use one entrypoint with task-specific modules. A sentence edit needs no app audit; a visual audit must assess style and color as well as copy and working controls. Embedded use inherits the containing task without a separate interview, report, or approval gate.

Chat operations: `audit` inspects; `browser-audit` operates a web UI; `revise` applies authorized edits; `draft` creates the requested artifact. The terminal executable only installs the skill.

## Load the relevant modules

| Work | Guidance |
| --- | --- |
| Prose or interface wording | [Editorial method](references/editorial-method.md); [Korean](references/writing-profile.md) or [English](references/english-profile.md) profile when relevant. Other languages use shared principles with language-specific uncertainty disclosed. |
| Layout, hierarchy, components, or app design | [Interface composition](references/design-profile.md), including its visual-language module. |
| Style, palette, type, surfaces, or decoration | [Visual style and color](references/visual-style.md), even when no image asset is involved. |
| App-level audit | [Domain and UX preparation](references/domain-research.md) before findings. Bounded edits stay bounded. |
| Requested interactive walkthrough | [Browser audit](references/browser-audit.md); static inspection cannot complete an interactive target's walkthrough. |
| Reporting a finding | [Finding and evidence policy](references/finding-evidence.md), then relevant [canonical rules](references/rules.md). Draft from the brief, not the rule catalog. |

Use [before/after examples](references/before-after.md) and [regression cases](tests/regression_cases.json) only to resolve relevant borderline decisions. They do not authorize edits or supply facts for the current artifact.

## Maintenance

Read [comparison notes](references/skill-comparison.md). Run `npm test` in the repository, or `python3 tests/validate_package.py` from a portable skill copy. These validate structure and fixtures, not agent judgment. Use [behavior evaluation](tests/behavior-evaluation.md) and [browser evaluation](tests/browser-evaluation.md) for observed executions. The [OMP extension](extensions/README.md) is optional and inactive.
