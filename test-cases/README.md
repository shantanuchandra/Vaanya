# Vaanaya PAC Test Cases

This package contains 1,000 deterministic, synthetic multilingual PAC cases for application testing. It is designed to verify source-linked extraction, visible uncertainty, targeted clarification, clinician approval, and patient-handoff boundaries.

It is not a clinical dataset, clinical protocol, or efficacy benchmark.

## Contents

| Path | Purpose |
|---|---|
| `schema/case.schema.json` | Portable JSON Schema contract |
| `templates/scenario_templates.json` | Clinician-readable source templates |
| `corpus/vaanaya-pac-v1.jsonl` | Generated 1,000-case corpus |
| `golden/golden-cases.jsonl` | Fifteen representative review/demo cases |
| `golden/clinical-review-checklist.md` | Anesthesiologist review workflow |
| `reports/coverage.md` | Generated distribution and safety coverage |
| `lib/contracts.mjs` | Runtime case and corpus invariants |
| `scripts/` | Generation, validation, and reporting CLIs |
| `tests/` | Behavioral and integration tests |

## Distribution

- 700 Hindi/Hinglish cases
- 150 Kannada/Kanglish cases
- 150 English cases
- 15 scenario families
- At least 60% D3–D5 cases

See [coverage.md](reports/coverage.md) for current measured coverage.

## Commands

Run from the workspace root:

```bash
node test-cases/scripts/generate-corpus.mjs
node test-cases/scripts/validate-corpus.mjs test-cases/corpus/vaanaya-pac-v1.jsonl
node test-cases/scripts/coverage-report.mjs
node --test test-cases/tests/*.test.mjs
```

The scripts use Node.js built-ins and require no package installation.

## Case behavior

Every case defines:

- a synthetic conversation;
- hidden test-author facts;
- expected PAC field states;
- required transcript citations;
- uncertainty that must remain unresolved;
- targeted clarification intent;
- prohibited inference and action;
- required clinician review and sign-off;
- provenance and clinical-review status.

Captured and uncertain fields cite source turns. The system must not infer medicine identity, allergy reaction, diagnosis, ASA class, anesthetic fitness, a prescription, a medication-holding instruction, or an anesthetic plan.

## Systems feedback loop

```text
scenario template
  → deterministic generation
  → contract validation
  → coverage measurement
  → anesthesiologist golden-case review
  → issue classification
  → template or contract revision
  → full regeneration
```

Generated JSONL records are never edited manually. A manual patch would break traceability and disappear on regeneration.

## Extending the corpus

1. Add or revise a scenario in `templates/scenario_templates.json`.
2. Add a failing test for the behavior or coverage gap.
3. Run the test and confirm the expected failure.
4. Change generator or validator code minimally.
5. Regenerate the full corpus.
6. Run validation and coverage reporting.
7. Have the affected golden case reviewed again.

## Clinical review

The golden set must be reviewed by an anesthesiologist before public demonstration. Review status is one of:

- `approved`
- `needs_revision`
- `unsafe`

Do not place reviewer names, patient information, or real clinical records in this package.

## Limitations

- Synthetic cases do not establish clinical accuracy, safety, time savings, or patient outcomes.
- Language variants do not represent every accent, dialect, or code-mixing pattern.
- Published evidence in the Source of Truth is not a local hospital baseline.
- Local forms, policy, interpreter requirements, and clinician judgment govern any real workflow.

