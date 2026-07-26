# Vaanaya Clinical Test Corpus — Design Specification

**Status:** Approved design  
**Date:** 2026-07-26  
**Purpose:** Define a reproducible, clinically cautious corpus of at least 1,000 synthetic pre-anesthetic check-up (PAC) cases for product development, regression testing, and buildathon evidence.

## 1. Outcome

The corpus will test whether Vaanaya can turn multilingual and code-mixed PAC conversations into a source-linked draft while preserving uncertainty and requiring clinician approval.

It will not test diagnosis, ASA classification, anesthetic fitness, prescribing, medication-holding instructions, or selection of an anesthetic plan.

## 2. Corpus composition

The initial release contains exactly 1,000 synthetic cases:

| Language path | Count | Purpose |
|---|---:|---|
| Hindi/Hinglish | 700 | Primary product and live-demo path |
| Kannada/Kanglish | 150 | Secondary regional-language path |
| English | 150 | Extraction controls and comparison cases |

Cases are generated from clinician-reviewable scenario templates rather than flat utterance lists. A small golden subset will be manually reviewed by an anesthesiologist.

## 3. Clinical priority model

The corpus emphasizes information whose absence, ambiguity, contradiction, or inaccurate inference can materially weaken a PAC record:

- current and recently stopped medicines, including colloquial descriptions;
- allergies and the reaction experienced;
- previous anesthesia exposure and complications;
- relevant medical history and prior events the patient does not initially recall;
- fasting/readiness statements;
- procedure and encounter context;
- family history when elicited;
- investigations or documents mentioned but not available;
- caregiver additions and contradictions;
- corrections, recency bias, uncertain dates, uncertain names, and incomplete recall.

Clinical priorities in the learning document must be marked as one of:

1. **Published evidence** — supported by a cited authoritative guideline or study.
2. **Clinician observation** — supplied or validated by the participating anesthesiologist.
3. **Synthetic assumption** — created only to test product behavior.

No synthetic assumption may be presented as a clinical fact or measured impact.

## 4. Case schema

Each JSONL record contains:

- `case_id`: stable identifier;
- `schema_version`: corpus schema version;
- `title`: concise human-readable scenario;
- `language`: primary language and code-mixing mode;
- `patient_profile`: synthetic age band, procedure context, and relevant communication factors;
- `scenario_tags`: risk area, ambiguity type, difficulty, and workflow stage;
- `conversation`: ordered doctor, patient, and optional caregiver turns;
- `hidden_facts`: test-author truth used only for evaluation;
- `expected_pac`: expected structured field states;
- `source_expectations`: expected turn citations for each proposed field;
- `uncertainties`: details the system must leave uncertain;
- `required_clarifications`: neutral follow-up prompts or prompt intents;
- `prohibited_inferences`: facts or clinical decisions the system must not generate;
- `expected_workflow`: required review, edit, sign-off, and patient-handoff state;
- `assertions`: machine-checkable behavioral expectations;
- `provenance`: generator/template identifiers and evidence classification;
- `clinical_review`: review status, reviewer role, and notes without personal identifiers.

## 5. Field-state model

Every PAC field uses one of five states:

- `captured`
- `uncertain`
- `missing`
- `intentionally_skipped`
- `clinician_entered`

AI-proposed `captured` or `uncertain` content must cite conversation turn IDs. The corpus must reject silent inference from demographic stereotypes, procedure type, incomplete medicine descriptions, or unrelated history.

## 6. Scenario families

The generator will combine curated templates across these families:

1. Medication identity, dose, frequency, indication, and last use.
2. Anticoagulant or antiplatelet colloquial descriptions without invented drug names.
3. Allergy versus side effect versus unknown reaction.
4. Prior anesthesia complications, including vague or caregiver-supplied recollection.
5. Forgotten remote events surfaced through contextual follow-up.
6. Fasting statements involving solids, clear liquids, tea, milk, chewing products, or uncertain time.
7. Comorbidity history with incomplete dates or control status.
8. Conflicting patient, caregiver, and paper-record statements.
9. Mid-sentence correction and “no, wait, actually” turns.
10. Code-switching, transliterated medicine names, numbers, and dates.
11. Noise or low-confidence segments requiring targeted repetition.
12. Missing reports, prescriptions, or medicine strips.
13. Unsupported requests for diagnosis, fitness, risk class, or medication instructions.
14. Patient-language instruction and teach-back grounded only in approved content.
15. Session/handoff continuity, correction propagation, and access boundaries.

## 7. Difficulty ladder

- **D1:** direct, complete statement with a single expected field.
- **D2:** ordinary code-mixing or one missing attribute.
- **D3:** clinically relevant ambiguity requiring one clarification.
- **D4:** contradiction, caregiver correction, noisy segment, or multiple linked fields.
- **D5:** combined ambiguity, correction, multilingual content, incomplete recall, and a safety boundary.

At least 60% of cases must be D3–D5. The golden demo set must contain one D2, one D4, and one D5 case.

## 8. Generation architecture

The corpus package contains:

```text
test-cases/
  README.md
  schema/
    case.schema.json
  templates/
    scenario_templates.json
  corpus/
    vaanaya-pac-v1.jsonl
  golden/
    golden-cases.jsonl
    clinical-review-checklist.md
  scripts/
    generate-corpus.mjs
    validate-corpus.mjs
    coverage-report.mjs
  tests/
    corpus.test.mjs
  reports/
    coverage.md
```

Generation is deterministic from a fixed seed. Template selection and surface-language variation may change wording but may not change hidden facts, safety boundaries, or expected field states.

## 9. Validation rules

Automated validation must prove:

- exactly 1,000 unique cases;
- 700 Hindi/Hinglish, 150 Kannada/Kanglish, and 150 English cases;
- every record conforms to the JSON Schema;
- every expected captured field has at least one valid source turn;
- no uncertain field is asserted as confirmed;
- every ambiguity has either a clarification or an explicit unresolved outcome;
- every case requires clinician review and forbids autonomous sign-off;
- every case uses synthetic identifiers and contains no real patient data;
- scenario-family and difficulty coverage meet declared thresholds;
- generation is deterministic;
- corpus files parse without warnings or malformed lines.

## 10. Golden set

The golden set contains 12–20 representative cases selected from the generated corpus. It is manually reviewed for:

- clinical plausibility;
- natural Hindi/Hinglish and Kannada/Kanglish phrasing;
- correctness of expected extraction;
- sufficiency and neutrality of clarification;
- prohibited inference coverage;
- appropriate clinician approval boundary;
- suitability for live and fallback demos.

Reviewer disagreement is recorded as a corpus issue; it is not silently resolved by changing the expected answer.

## 11. Research Source of Truth

A companion learning document will summarize:

- the purpose and boundaries of pre-anesthesia evaluation;
- a paper-based PAC information model;
- evidence on medication/allergy discrepancies and incomplete records;
- high-consequence information categories;
- recall, correction, caregiver, and language-friction patterns;
- safe product behaviors and prohibited automation;
- evidence-backed test priorities;
- open questions for the anesthesiologist reviewer;
- demo impact assumptions and how to validate clinician time saved.

The document will cite authoritative sources and distinguish evidence, clinician input, and assumptions inline.

## 12. Success criteria

The package is complete when:

1. all 1,000 cases validate;
2. the declared language distribution is exact;
3. the coverage report demonstrates risk-family and difficulty breadth;
4. the golden set can exercise three end-to-end demo scenarios;
5. an anesthesiologist can review cases without reading generator code;
6. the corpus can later be consumed by automated extraction and workflow tests.

## 13. Explicit non-goals

- Real patient data.
- Claims that generated cases establish clinical efficacy.
- Autonomous clinical decisions.
- Exhaustive representation of every Indian language or dialect.
- Medication-management recommendations.
- Benchmarking Sarvam accuracy before the application adapters exist.
- Replacing local hospital PAC policy or clinician judgment.

