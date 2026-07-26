# Vaanaya Implementation Plan

## Current implementation artifacts

- [Ordered build checklist](BUILD_CHECKLIST.md)
- [Clinical corpus design](docs/superpowers/specs/2026-07-26-vaanaya-clinical-test-corpus-design.md)
- [Clinical corpus implementation plan](docs/superpowers/plans/2026-07-26-vaanaya-clinical-test-corpus.md)
- [PAC Source of Truth](docs/clinical/vaanaya-pac-source-of-truth.md)
- [Test corpus guide](test-cases/README.md)
- [Coverage report](test-cases/reports/coverage.md)
- [Golden cases](test-cases/golden/golden-cases.jsonl)
- [Clinical review checklist](test-cases/golden/clinical-review-checklist.md)

The executable corpus is the first implementation layer. Product work should consume its contracts in this order: Sarvam voice capture, source-linked PAC extraction, uncertainty prompts, clinician review/sign-off, approved patient-language handoff, Telegram continuity, persistence, and hosted demo verification.
