# Procedure-Aware PAC Checklist Design

## Objective

Turn the current flat PAC proposal list into an evidence-backed completeness
checklist selected by procedure and clinical context. The checklist must show a
clinician what was answered, what remains uncertain or missing, and what only a
clinician may enter. It must never represent synthetic checklist coverage as a
validated clinical protocol.

The buildathon success path is:

1. a clinician selects a procedure;
2. Vaanaya instantiates the applicable checklist version;
3. Sarvam transcript evidence and OpenAI proposals map to checklist items;
4. categories show answered and unresolved counts;
5. selecting an item reveals its Evidence Rail sources and applicability
   rationale;
6. unresolved required items block signing;
7. clinician resolution updates completeness without deleting original
   evidence.

## Clinical and Product Boundary

The checklist starts from
`docs/clinical/vaanaya-pac-source-of-truth.md`. It is a synthetic coverage model
until the participating anesthesiologist validates it against the local paper
PAC form.

Every checklist surface must show:

> Synthetic checklist — clinician validation pending

The checklist may organize documentation and expose gaps. It must not:

- diagnose or interpret a condition;
- assign ASA class or determine anesthetic fitness;
- recommend an anesthetic technique;
- infer medicine identity, dose, last use, allergy or fasting information;
- create airway, examination or clinician-conclusion findings;
- infer pregnancy status or applicability from a name, sex or gender alone;
- sign or resolve an item on the clinician's behalf.

Procedure selection changes which documentation questions appear. It does not
create patient facts or clinical advice.

## Approaches Considered

### 1. Flat proposal labels with UI-only grouping

This is the smallest change, but it leaves applicability, validation authority
and sign-off rules distributed across React components. Worklist and sign-off
counts could disagree. Rejected because the server would not own completeness.

### 2. Versioned checklist engine in application contracts — selected

Define versioned templates, procedure modifiers and a deterministic evaluation
engine in the shared contracts package. API and UI consume the same evaluated
checklist. This adds a focused domain layer while keeping templates in source
control for buildathon reliability.

### 3. Database-administered clinical form builder

Store arbitrary organizations, forms, rules and versions in Supabase with an
admin editor. This is appropriate later but creates configuration, migration
and validation scope that does not improve the three-minute demo. Deferred.

## Domain Model

### Checklist template

A checklist template contains:

- stable `templateId`;
- immutable semantic `version`;
- display name;
- validation status: `synthetic`, `clinician_reviewed`;
- ordered category definitions;
- supported procedure-family modifiers.

Version `synthetic-pac-v1` is the only MVP version. Signed encounters retain the
version identifier used at sign-off.

### Category definition

Each category contains:

- stable category ID;
- label and description;
- display order;
- ordered item definitions.

MVP categories:

1. encounter and consent;
2. medical history;
3. medicines;
4. allergies;
5. previous anesthesia;
6. fasting and aspiration history;
7. investigations and documents;
8. examination;
9. procedure-specific documentation;
10. open items and clinician conclusion.

### Checklist item definition

Each item contains:

- stable item ID;
- category ID;
- clinician-facing question;
- neutral applicability rationale;
- requirement level: `required`, `optional`;
- completion authority: `evidence_or_clinician`, `clinician_only`;
- gap severity: `critical`, `standard`;
- whether a clinician may explicitly defer it;
- applicability rule;
- optional clarification guidance;
- explicit prohibition text where unsafe inference is likely.

An applicability rule uses a small declarative vocabulary:

- `always`;
- `procedure_family`;
- `clinician_selected_context`.

The MVP does not evaluate demographic or diagnostic expressions. Context-gated
items are activated only by an explicit clinician selection.

### Procedure families

The clinician-entered procedure is normalized into one of:

- `laparoscopic_abdominal`;
- `hysterectomy`;
- `knee_replacement`;
- `upper_gi_endoscopy`;
- `urological`;
- `cataract`;
- `breast`;
- `generic`.

Matching is deterministic and explainable. Unknown procedures use `generic`;
they never silently inherit a specialist modifier.

### Encounter checklist

An encounter records:

- template ID and version;
- selected procedure family;
- applicable item IDs;
- explicit clinician-selected context flags;
- evaluated item results.

The template remains the definition source. Encounter results reference stable
item IDs rather than copying rule logic.

## Item States and Completeness

Evaluated item status is separate from proposal state:

- `answered`: supported by transcript evidence or explicit clinician entry;
- `uncertain`: relevant content exists but material attributes are unclear;
- `missing`: no supported answer exists;
- `deferred`: clinician explicitly marked the item intentionally skipped or
  deferred;
- `clinician_required`: an applicable clinician-only item has no entry;
- `not_applicable`: the rule did not activate the item.

Mapping from the existing field proposal model:

| Proposal condition | Checklist result |
|---|---|
| `captured` with valid source turns | `answered` |
| `clinician_entered` | `answered` |
| `uncertain` | `uncertain` |
| `missing` or no matching proposal | `missing` |
| `intentionally_skipped` | `deferred` |
| clinician-only item without clinician entry | `clinician_required` |
| applicability rule false | `not_applicable` |

A captured proposal whose source IDs do not exist in the encounter transcript
cannot count as answered.

The field-proposal contract will allow an empty `sourceTurnIds` array only for
`missing`, `intentionally_skipped` and `clinician_entered`. `captured` and
`uncertain` continue to require at least one valid transcript source. This
supports examination and conclusion entries without manufacturing transcript
evidence.

Category counts include applicable items only. The overall checklist is ready
for sign-off when every required applicable item is `answered` or `deferred`.
`deferred` remains visually distinct and auditable. Required `uncertain`,
`missing` and `clinician_required` items block signing.

Optional gaps remain visible but do not block signing.
Deferral is allowed only when the item definition explicitly permits it and
requires a clinician-entered reason. Identity, procedure, consent and clinician
conclusion are not deferrable in `synthetic-pac-v1`.

## MVP Checklist Content

The generic template will include a deliberately bounded set:

- identity/procedure/consent confirmation;
- relevant medical history;
- current or recent medicines;
- allergy status and reaction uncertainty;
- previous anesthesia and recalled complications;
- reported fasting intake and time;
- mentioned investigations or missing documents;
- clinician-entered examination;
- open-item review;
- clinician-entered conclusion.

Procedure modifiers add documentation prompts only:

- laparoscopic abdominal: recent relevant symptoms and prior abdominal
  procedure history when discussed;
- hysterectomy: bleeding-history evidence, mentioned anaemia investigation and
  prior pelvic procedure history;
- knee replacement: functional-history discussion and medicine reconciliation;
- upper-GI endoscopy: reflux/aspiration-history discussion and reported fasting;
- urological: previous-anesthesia history and current medicine reconciliation;
- cataract: current medicine and allergy reconciliation;
- breast: previous-anesthesia, medicine and allergy reconciliation.

These modifiers are synthetic assumptions requiring clinician review. They do
not prescribe investigations or alter clinical management.

Pregnancy-related documentation is not activated from the procedure or patient
profile alone. It requires an explicit clinician-selected context flag and is
then recorded as a question whose answer may remain unknown.

## Architecture

### Shared contracts

Add a focused checklist module in `packages/contracts` containing:

- Zod schemas and TypeScript types;
- the versioned synthetic template;
- deterministic procedure-family normalization;
- applicability evaluation;
- proposal-to-item mapping;
- category and overall completeness calculation;
- sign-blocker selection.

The evaluator is pure: encounter plus template produces an evaluated checklist.
It does not call Sarvam, OpenAI, Supabase or React.

### API

The API:

- returns evaluated checklist data with encounter responses;
- uses the evaluator for recording worklist counts;
- uses the same sign blockers for the sign endpoint;
- records the checklist template/version in sign audit detail;
- continues to store transcript turns and proposals as the evidence source.

Resolving an existing uncertain proposal updates it as today. Entering a value
for a missing or clinician-only checklist item creates a
`clinician_entered` proposal with no transcript sources and an audit event that
identifies the clinician. Deferring an eligible item creates or updates an
`intentionally_skipped` proposal with the clinician and reason in the audit
event. The API rejects deferral when the item definition is not deferrable.

OpenAI extraction receives the applicable stable item IDs and labels. Its
output may propose values and source turns only; it does not determine
applicability or requirement levels.

### Web application

The PAC sheet replaces the flat proposal list with category disclosure
components. Each category header shows:

- answered/applicable count;
- blocking-gap count;
- clinician-required count when non-zero.

Opening a category shows each item, state, value, applicability rationale and
source links. Selecting a source highlights the existing Evidence Rail. The
current clarification drawer remains the resolution surface.

The recordings page consumes server-calculated checklist counts; it does not
recompute them.

## Data Flow

1. Clinician selects a procedure and optional context flags.
2. Server normalizes the procedure family.
3. Checklist engine computes applicable items deterministically.
4. Recording processing sends only those item IDs and labels to OpenAI.
5. OpenAI returns proposal values, states and source turn IDs.
6. Server rejects unknown item IDs and invalid source links.
7. Evaluator produces category and overall states.
8. UI renders categories and highlights evidence.
9. Clinician resolves uncertain or missing items.
10. Sign endpoint recomputes the checklist and blocks unresolved requirements.
11. Signed audit/version records the checklist template and version.

## Error Handling

- Unknown procedure: use generic checklist and display “Generic procedure
  coverage.”
- Unknown OpenAI field ID: ignore it, append a structured processing warning and
  do not count it.
- Invalid transcript source: item cannot become answered.
- Missing checklist version: refuse signing and show a configuration error.
- Unsupported context flag: ignore it and record an audit warning.
- Processing failure: preserve earlier transcript, proposals and checklist
  state; expose retry.
- Template changes: existing signed encounters continue to reference their
  original version.

## UI Behavior

Default category state:

- expand the first category containing a blocking gap;
- otherwise expand the first category;
- allow only one expanded category on narrow screens;
- preserve visible textual state labels in addition to color.

Example:

```text
Medicines                 1/3 answered   2 gaps
Allergies                 1/2 answered   1 uncertain
Previous anesthesia       2/2 answered
Examination               Clinician required
Procedure-specific        1/3 answered   2 gaps
```

No category is hidden merely because every item is missing. `not_applicable`
items are excluded from counts and are shown in a collapsed “Not applicable”
section for auditability.

## Persistence

For the buildathon:

- template definitions live in version-controlled application code;
- encounter audit and signed-note content record template ID and version;
- existing proposal/source persistence remains the answer store;
- synthetic demo encounters use the stable memory store;
- real encounters use Supabase when enabled.

A database-administered template catalog and hospital form builder are
non-goals.

## Testing

Implementation follows test-driven development.

### Contract tests

- procedure normalization for all seven demo families and generic fallback;
- category ordering and stable unique IDs;
- applicability never derives from name or gender;
- clinician-selected context activation;
- every proposal-state mapping;
- captured proposal with missing source remains unresolved;
- optional gap does not block signing;
- required uncertain, missing or clinician-required items block signing;
- deferred required item is explicit and signable;
- checklist version appears in signed audit detail.

### API/store tests

- processing passes only applicable item definitions to OpenAI;
- unknown model fields and invalid source links do not count;
- worklist counts equal encounter checklist counts;
- checklist evaluation survives save/reload;
- processed recording is reused without another Sarvam/OpenAI call;
- signed-note persistence retains checklist version.

### UI tests

- categories render in defined order;
- headers show answered, applicable and gap counts;
- category disclosure opens and closes accessibly;
- first blocking category opens by default;
- selecting an item highlights existing Evidence Rail sources;
- clinician-only and synthetic-validation labels are visible;
- sign action remains disabled while blockers exist;
- mobile layout retains status and primary actions.

### Live demo verification

Use Shantanu Chandra:

1. open the processed recording;
2. confirm category counts appear;
3. open Medicines;
4. select the blood-thinner item;
5. verify the original Hindi statement is highlighted;
6. verify medicine identity remains uncertain;
7. verify signing is blocked;
8. enter a neutral clinician-confirmed resolution;
9. verify completeness updates and the original evidence remains;
10. sign and verify checklist version appears in the audit/signed record.

## Delivery Sequence

1. shared checklist contracts and pure evaluator;
2. sign-gate integration;
3. server response and worklist counts;
4. extraction constraints and proposal validation;
5. category UI and Evidence Rail interaction;
6. synthetic cohort mappings;
7. persistence/version audit;
8. full automated and live-browser verification.

## Non-Goals

- a clinical protocol or claim of clinical validation;
- autonomous applicability based on demographics;
- arbitrary rule expressions;
- hospital form administration;
- ASA grading, fitness, diagnosis or treatment advice;
- FHIR/HL7 export;
- replacing clinician examination or conclusion;
- streaming STT changes;
- rebuilding the Evidence Rail;
- production multi-tenant checklist customization.

## Acceptance Criteria

- All seven demo procedure families instantiate deterministic checklist
  categories.
- Generic fallback works for unknown procedures.
- Every answered AI-proposed item has at least one valid transcript source.
- Required unresolved and clinician-only items block sign-off.
- Worklist, PAC sheet and sign endpoint use the same completeness calculation.
- The UI groups items by accessible category dropdowns.
- The Evidence Rail remains the source viewer.
- The synthetic-validation label is visible.
- Shantanu's blood-thinner uncertainty stays unresolved until clinician action.
- Existing automated tests, type-check and production build remain green.
- Live browser verification passes the ten-step demo flow.
