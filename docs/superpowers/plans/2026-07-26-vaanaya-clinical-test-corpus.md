# Vaanaya Clinical Test Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, clinically cautious, machine-validatable corpus of exactly 1,000 synthetic multilingual PAC cases plus a research-backed Source of Truth and clinician-reviewable golden set.

**Architecture:** A dependency-free Node.js generator expands curated clinical scenario templates into JSONL. A separate validator enforces schema, safety, source-link, distribution, and coverage contracts; a report script summarizes the resulting corpus. Human-readable clinical guidance and golden cases sit beside the executable artifacts.

**Tech Stack:** Node.js 20+ built-ins, ECMAScript modules, `node:test`, JSON Schema 2020-12 as a documented interchange contract, Markdown, JSONL.

## Global Constraints

- Generate exactly 1,000 cases: 700 Hindi/Hinglish, 150 Kannada/Kanglish, and 150 English.
- At least 60% of cases must have difficulty D3–D5.
- Use synthetic data only; no real patient identifiers or records.
- Every AI-proposed captured or uncertain PAC field must cite valid conversation turn IDs.
- Never infer a medicine name, allergy reaction, diagnosis, ASA class, anesthetic fitness, prescription, medication-holding instruction, or anesthetic plan.
- Every final note requires clinician review and explicit sign-off.
- Published evidence, clinician observation, and synthetic assumption must remain distinguishable.
- Generation must be deterministic from a fixed seed.
- The workspace is not currently a Git repository, so plan checkpoints replace commit steps unless the user initializes Git.

---

## File map

| File | Responsibility |
|---|---|
| `docs/clinical/vaanaya-pac-source-of-truth.md` | Evidence-backed PAC learning document and product boundaries |
| `test-cases/schema/case.schema.json` | Portable record contract |
| `test-cases/lib/contracts.mjs` | Runtime validation and corpus-level invariants |
| `test-cases/templates/scenario_templates.json` | Clinician-reviewable scenario definitions and utterance variants |
| `test-cases/scripts/generate-corpus.mjs` | Deterministic 1,000-case generation |
| `test-cases/scripts/validate-corpus.mjs` | CLI validation with non-zero failure exit |
| `test-cases/scripts/coverage-report.mjs` | Coverage calculation and Markdown report generation |
| `test-cases/corpus/vaanaya-pac-v1.jsonl` | Generated corpus |
| `test-cases/golden/golden-cases.jsonl` | Representative demo and regression cases |
| `test-cases/golden/clinical-review-checklist.md` | Anesthesiologist review instructions |
| `test-cases/reports/coverage.md` | Generated distribution and safety coverage |
| `test-cases/tests/contracts.test.mjs` | Unit tests for case validation |
| `test-cases/tests/generator.test.mjs` | Determinism and exact-distribution tests |
| `test-cases/tests/corpus.test.mjs` | Full-corpus integrity and safety tests |
| `test-cases/README.md` | Commands, format, limitations, and extension guide |

---

### Task 1: Clinical Source of Truth

**Files:**
- Create: `docs/clinical/vaanaya-pac-source-of-truth.md`

**Interfaces:**
- Consumes: ASA preanesthesia evaluation guidance, WHO safe-surgery material, peer-reviewed medication-history evidence, and clearly labelled clinician observations.
- Produces: the field taxonomy, safety boundaries, scenario-priority rationale, evidence labels, and review questions used by later tasks.

- [ ] **Step 1: Write the evidence model**

Create the document with three explicit labels:

```markdown
> Evidence labels
> - **[Evidence]** Supported by the cited publication or guideline.
> - **[Clinician validation]** Must be confirmed by the participating anesthesiologist.
> - **[Synthetic assumption]** Exists only to exercise product behavior.
```

- [ ] **Step 2: Document the evidence-backed workflow**

Cover patient interview, pertinent-record review, physical examination boundary, medications/allergies, prior anesthesia, comorbidities, aspiration/readiness context, investigations referenced, uncertainties, and clinician conclusion. Cite sources next to claims and never turn the document into treatment guidance.

- [ ] **Step 3: Define the time-saving measurement**

Use this demo-safe protocol:

```markdown
Primary metric: clinician minutes from encounter start to signed PAC record.
Baseline: three paper PAC cases timed by the participating anesthesiologist.
Prototype: the same three synthetic cases completed with Vaanaya.
Report: median and individual times; label this a demonstration, not clinical efficacy.
```

- [ ] **Step 4: Self-review the document**

Run:

```bash
rg -n 'TBD|TODO|diagnose|recommend stopping|safe to proceed' docs/clinical/vaanaya-pac-source-of-truth.md
```

Expected: no placeholders and no autonomous clinical recommendation.

---

### Task 2: Runtime Contract and JSON Schema

**Files:**
- Create: `test-cases/tests/contracts.test.mjs`
- Create: `test-cases/lib/contracts.mjs`
- Create: `test-cases/schema/case.schema.json`

**Interfaces:**
- Produces: `validateCase(caseRecord): string[]`, `validateCorpus(caseRecords): string[]`, and the case record property names defined in the approved design.

- [ ] **Step 1: Write the failing contract tests**

Test real behavior using hand-authored fixtures:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCase } from '../lib/contracts.mjs';

test('rejects a captured PAC field without a valid source turn', () => {
  const record = validFixture();
  record.expected_pac.medications = {
    state: 'captured',
    value: 'aspirin',
    source_turn_ids: ['missing-turn']
  };
  assert.match(validateCase(record).join('\n'), /source turn/i);
});

test('rejects autonomous clinical decisions', () => {
  const record = validFixture();
  record.prohibited_inferences = [];
  record.expected_workflow.autonomous_signoff_allowed = true;
  assert.match(validateCase(record).join('\n'), /sign.?off/i);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test test-cases/tests/contracts.test.mjs
```

Expected: FAIL because `test-cases/lib/contracts.mjs` does not exist.

- [ ] **Step 3: Implement the minimal runtime validator**

`validateCase` must check required keys, enumerations, unique turn IDs, valid source references, uncertainty consistency, synthetic identifiers, prohibited clinical decisions, and required clinician review/sign-off.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same `node --test` command. Expected: all contract tests pass.

- [ ] **Step 5: Add corpus-level failing tests**

Test that `validateCorpus` rejects duplicate IDs, wrong language counts, fewer than 60% D3–D5 cases, and fewer than 1,000 cases.

- [ ] **Step 6: Implement corpus-level validation and JSON Schema**

The JSON Schema mirrors the runtime contract and declares `additionalProperties: false` for the top-level record and all stable nested objects.

- [ ] **Step 7: Run contract tests**

Expected: all contract and corpus-invariant tests pass with no warnings.

---

### Task 3: Scenario Templates and Deterministic Generator

**Files:**
- Create: `test-cases/tests/generator.test.mjs`
- Create: `test-cases/templates/scenario_templates.json`
- Create: `test-cases/scripts/generate-corpus.mjs`
- Create: `test-cases/corpus/vaanaya-pac-v1.jsonl`

**Interfaces:**
- Consumes: `validateCase` and scenario templates.
- Produces: `generateCorpus({ seed = 20260726 }): object[]` and a CLI that writes JSONL.

- [ ] **Step 1: Write failing generator tests**

```js
test('generates the exact approved language distribution', () => {
  const cases = generateCorpus({ seed: 20260726 });
  assert.equal(cases.length, 1000);
  assert.deepEqual(countBy(cases, c => c.language.path), {
    'hi-hinglish': 700,
    'kn-kanglish': 150,
    'en': 150
  });
});

test('is deterministic for a fixed seed', () => {
  assert.deepEqual(
    generateCorpus({ seed: 20260726 }),
    generateCorpus({ seed: 20260726 })
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test test-cases/tests/generator.test.mjs
```

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Author scenario templates**

Include all 15 approved scenario families. Every template defines language variants, hidden facts, expected field states, required clarification intent, prohibited inference, difficulty, and source mapping. Include the approved colloquial anticoagulant scenario as a D4 golden candidate.

- [ ] **Step 4: Implement minimal deterministic generation**

Use a small seeded PRNG, stable template iteration, synthetic profiles, and controlled phrase variants. Generated facts and expected outputs come from the same immutable template record, while validator assertions independently enforce the output contract.

- [ ] **Step 5: Run generator tests and verify GREEN**

Expected: exact counts, unique IDs, deterministic output, and at least 600 D3–D5 cases.

- [ ] **Step 6: Generate the corpus**

Run:

```bash
node test-cases/scripts/generate-corpus.mjs
```

Expected: `test-cases/corpus/vaanaya-pac-v1.jsonl` with exactly 1,000 newline-delimited records.

---

### Task 4: Full Corpus Validator

**Files:**
- Create: `test-cases/tests/corpus.test.mjs`
- Create: `test-cases/scripts/validate-corpus.mjs`

**Interfaces:**
- Consumes: JSONL corpus and `validateCorpus`.
- Produces: CLI exit code 0 plus summary on success; exit code 1 plus line-specific errors on failure.

- [ ] **Step 1: Write the failing CLI behavior test**

Create a temporary malformed JSONL file and assert the validator returns a non-zero code and identifies the line. Create a valid fixture file and assert code 0.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test test-cases/tests/corpus.test.mjs
```

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the JSONL reader and validator CLI**

Malformed JSON, blank records, schema violations, corpus invariant failures, and unsafe workflow states must produce actionable errors.

- [ ] **Step 4: Run test and verify GREEN**

Expected: all CLI tests pass.

- [ ] **Step 5: Validate the generated corpus**

Run:

```bash
node test-cases/scripts/validate-corpus.mjs test-cases/corpus/vaanaya-pac-v1.jsonl
```

Expected summary:

```text
Validated 1000 cases
hi-hinglish: 700
kn-kanglish: 150
en: 150
errors: 0
```

---

### Task 5: Coverage Report and Golden Cases

**Files:**
- Create: `test-cases/scripts/coverage-report.mjs`
- Create: `test-cases/reports/coverage.md`
- Create: `test-cases/golden/golden-cases.jsonl`
- Create: `test-cases/golden/clinical-review-checklist.md`

**Interfaces:**
- Consumes: validated corpus.
- Produces: Markdown coverage tables and a 15-case golden set spanning D2, D4, D5 and all major risk families.

- [ ] **Step 1: Write a failing coverage assertion**

Add a test that requires every scenario family to appear, all three language paths to appear, D3–D5 coverage to be at least 60%, and at least one case each for contradiction, correction, low confidence, forgotten remote event, and prohibited medical-advice request.

- [ ] **Step 2: Run and verify RED**

Expected: FAIL until reporting and golden selection exist.

- [ ] **Step 3: Implement coverage calculation**

The report must include totals by language, difficulty, scenario family, ambiguity type, field state, clarification requirement, and prohibited inference.

- [ ] **Step 4: Select golden cases deterministically**

Choose 15 cases, including:

- colloquial blood-thinner ambiguity;
- caregiver-recalled previous anesthesia complication;
- allergy with unknown reaction;
- fasting correction involving milk tea;
- forgotten remote cardiac/respiratory event;
- Kannada patient-instruction handoff;
- low-confidence medicine name;
- patient asking whether to stop a medicine;
- cross-session correction propagation.

- [ ] **Step 5: Write the clinical review checklist**

The reviewer records `approved`, `needs_revision`, or `unsafe`, plus phrasing, extraction, clarification, and safety-boundary notes. No reviewer name or patient information is stored.

- [ ] **Step 6: Generate and inspect the report**

Run:

```bash
node test-cases/scripts/coverage-report.mjs
```

Expected: report generated with no missing family and no threshold failure.

---

### Task 6: Package Documentation and Final Verification

**Files:**
- Create: `test-cases/README.md`
- Modify: `Vaanaya_Implementation_Plan.md`

**Interfaces:**
- Produces: human instructions for regenerating, validating, extending, and clinically reviewing the corpus.

- [ ] **Step 1: Document commands and limitations**

Include:

```bash
node test-cases/scripts/generate-corpus.mjs
node test-cases/scripts/validate-corpus.mjs test-cases/corpus/vaanaya-pac-v1.jsonl
node test-cases/scripts/coverage-report.mjs
node --test test-cases/tests/*.test.mjs
```

State that cases are synthetic, are not clinical efficacy evidence, and require local clinician review before use beyond product testing.

- [ ] **Step 2: Link artifacts from the implementation plan**

Replace the broken external plan link with local links to this implementation plan, the design spec, Source of Truth, corpus README, coverage report, and golden set.

- [ ] **Step 3: Run full verification**

Run:

```bash
node --test test-cases/tests/*.test.mjs
node test-cases/scripts/generate-corpus.mjs
node test-cases/scripts/validate-corpus.mjs test-cases/corpus/vaanaya-pac-v1.jsonl
node test-cases/scripts/coverage-report.mjs
wc -l test-cases/corpus/vaanaya-pac-v1.jsonl
```

Expected: all tests pass, validation reports zero errors, coverage thresholds pass, and `wc -l` reports `1000`.

- [ ] **Step 4: Perform a safety scan**

Run:

```bash
rg -n -i 'real patient|patient name|safe for surgery|asa class|stop (the |your )?medicine|hold (the |your )?medicine' test-cases docs/clinical
```

Inspect every match. Expected: only explicit prohibitions, synthetic test prompts, or documentation of boundaries; no generated autonomous clinical instruction.

