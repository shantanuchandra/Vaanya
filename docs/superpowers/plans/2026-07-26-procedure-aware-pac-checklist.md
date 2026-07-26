# Procedure-Aware PAC Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one versioned, procedure-aware PAC completeness engine that powers the recordings worklist, categorized PAC review, Evidence Rail selection and clinician sign gate.

**Architecture:** Add a pure checklist domain module to the shared contracts package. Encounters carry a versioned checklist context and an evaluated checklist snapshot; every encounter mutation recomputes that snapshot. The API constrains structured output to applicable stable item IDs, while React only renders the server-owned evaluation in accessible category disclosures.

**Tech Stack:** TypeScript 5.8, Zod 4, Vitest 3, Fastify 5, React 19, Supabase Postgres, OpenAI Responses API, Sarvam batch STT/translation.

## Global Constraints

- Checklist version is exactly `synthetic-pac-v1`.
- Every checklist surface displays `Synthetic checklist — clinician validation pending`.
- Procedure families are `laparoscopic_abdominal`, `hysterectomy`, `knee_replacement`, `upper_gi_endoscopy`, `urological`, `cataract`, `breast`, and `generic`.
- Applicability uses only `always`, `procedure_family`, and explicit `clinician_selected_context` rules.
- Never infer pregnancy applicability from a name, sex or gender.
- `captured` and `uncertain` proposals require at least one valid transcript source.
- `missing`, `intentionally_skipped`, and `clinician_entered` proposals may have no transcript sources.
- Required `uncertain`, `missing`, and `clinician_required` items block signing.
- Deferral requires a clinician reason and is forbidden for identity, procedure, consent, and clinician conclusion.
- OpenAI may propose values and sources; it may not determine applicability, requirement level, diagnosis, management or sign-off.
- Existing Evidence Rail remains the only transcript-source viewer.
- Existing user recordings and `.superpowers/` files are never modified or committed.

---

## File Structure

- Create `packages/contracts/src/checklist.ts`: checklist schemas, `synthetic-pac-v1` template, procedure normalization, pure evaluation and blocker selection.
- Create `packages/contracts/src/checklist.test.ts`: domain-level applicability, source integrity, counts and safety tests.
- Modify `packages/contracts/src/index.ts`: encounter checklist context/snapshot, conditional source validation, mutation helpers and checklist-driven sign gate.
- Modify `packages/contracts/src/workflow.test.ts`: clinician entry, deferral and signed-version tests.
- Modify `apps/api/src/demo-cohort.ts`: procedure-aware synthetic checklist contexts and evidence proposals.
- Modify `apps/api/src/demo-cohort.test.ts`: deterministic family and context coverage.
- Modify `apps/api/src/encounter-store.ts`: worklist metrics from the evaluated checklist.
- Modify `apps/api/src/encounter-store.test.ts`: worklist/checklist count equality.
- Modify `apps/api/src/openai-client.ts`: accept applicable checklist items in PAC structuring context.
- Modify `apps/api/src/openai-client.test.ts`: verify bounded stable IDs enter the OpenAI request.
- Create `apps/api/src/checklist-proposals.ts`: validate model/topic output and materialize applicable proposal states without silent inference.
- Create `apps/api/src/checklist-proposals.test.ts`: unknown ID, invalid source and missing-item behavior.
- Modify `apps/api/src/server.ts`: checklist-aware processing, clinician entry/defer routes and versioned signed responses.
- Modify `apps/api/src/server.test.ts`: API contract and sign-blocker integration.
- Modify `apps/api/src/supabase-encounter-store.ts`: rehydrate checklist context and preserve version in signed notes.
- Modify `apps/api/src/supabase-encounter-store.test.ts`: checklist save/reload mapping.
- Create `apps/web/src/PacChecklist.tsx`: accessible category disclosures and checklist item rows.
- Create `apps/web/src/PacChecklist.test.tsx`: category counts, default disclosure and Evidence Rail source action.
- Modify `apps/web/src/App.tsx`: render `PacChecklist`, resolve/enter/defer items and use server readiness.
- Modify `apps/web/src/App.test.tsx`: sign blocker and synthetic-label workflow.
- Modify `apps/web/src/api.ts`: clinician entry and deferral requests.
- Modify `apps/web/src/api.test.ts`: request/response validation.
- Modify `apps/web/src/styles.css`: category disclosure, status and responsive styles.
- Modify `docs/qa/2026-07-26-code-rca.md`: verification evidence and retained clinical boundary.

---

### Task 1: Pure Checklist Domain and Synthetic Template

**Files:**
- Create: `packages/contracts/src/checklist.ts`
- Create: `packages/contracts/src/checklist.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `SYNTHETIC_PAC_TEMPLATE`, `normalizeProcedureFamily(procedure: string): ProcedureFamily`, `evaluateChecklist(input: ChecklistEvaluationInput): EvaluatedChecklist`, `checklistBlockers(checklist: EvaluatedChecklist): EvaluatedChecklistItem[]`.
- Consumes: proposal-like `{ id, state, value, sourceTurnIds }` objects and transcript-like `{ id }` objects; no dependency on API, storage or React.

- [ ] **Step 1: Write failing normalization and safety tests**

```ts
import {
  normalizeProcedureFamily,
  SYNTHETIC_PAC_TEMPLATE
} from "./checklist";

it.each([
  ["Laparoscopic hernia repair", "laparoscopic_abdominal"],
  ["Laparoscopic hysterectomy", "hysterectomy"],
  ["Knee replacement", "knee_replacement"],
  ["Upper GI endoscopy", "upper_gi_endoscopy"],
  ["Transurethral urological procedure", "urological"],
  ["Cataract surgery", "cataract"],
  ["Breast surgery", "breast"],
  ["Unlisted procedure", "generic"]
])("normalizes %s", (procedure, expected) => {
  expect(normalizeProcedureFamily(procedure)).toBe(expected);
});

it("never encodes demographic applicability", () => {
  expect(JSON.stringify(SYNTHETIC_PAC_TEMPLATE)).not.toMatch(
    /gender|patient_name|female|male/i
  );
});
```

- [ ] **Step 2: Run the tests and verify the red state**

Run: `./node_modules/.bin/vitest run packages/contracts/src/checklist.test.ts`

Expected: FAIL because `./checklist` does not exist.

- [ ] **Step 3: Define checklist schemas and deterministic normalization**

```ts
export const ProcedureFamilySchema = z.enum([
  "laparoscopic_abdominal",
  "hysterectomy",
  "knee_replacement",
  "upper_gi_endoscopy",
  "urological",
  "cataract",
  "breast",
  "generic"
]);

export function normalizeProcedureFamily(procedure: string): ProcedureFamily {
  const value = procedure.trim().toLowerCase();
  if (/hysterectomy/.test(value)) return "hysterectomy";
  if (/laparoscop|cholecyst|hernia/.test(value))
    return "laparoscopic_abdominal";
  if (/knee|arthroplast/.test(value)) return "knee_replacement";
  if (/upper\\s*gi|endoscop/.test(value)) return "upper_gi_endoscopy";
  if (/urolog|transurethral/.test(value)) return "urological";
  if (/cataract/.test(value)) return "cataract";
  if (/breast/.test(value)) return "breast";
  return "generic";
}
```

Define the schemas named in the interface and export a frozen
`SYNTHETIC_PAC_TEMPLATE` with the ten ordered categories from the spec. Give
identity, procedure, consent and conclusion `deferrable: false`.

- [ ] **Step 4: Write failing evaluator tests**

```ts
it("does not activate pregnancy documentation without explicit context", () => {
  const result = evaluateChecklist({
    procedure: "Laparoscopic hysterectomy",
    contextFlags: [],
    proposals: [],
    transcript: []
  });
  expect(result.items.find(item => item.id === "pregnancy_context")?.status)
    .toBe("not_applicable");
});

it("requires valid evidence before captured content is answered", () => {
  const result = evaluateChecklist({
    procedure: "Cataract surgery",
    contextFlags: [],
    proposals: [{
      id: "medications",
      state: "captured",
      value: "Tablet reported",
      sourceTurnIds: ["missing-turn"]
    }],
    transcript: [{ id: "t1" }]
  });
  expect(result.items.find(item => item.id === "medications")?.status)
    .toBe("uncertain");
});
```

- [ ] **Step 5: Run the focused test and verify it fails**

Run: `./node_modules/.bin/vitest run packages/contracts/src/checklist.test.ts`

Expected: FAIL because `evaluateChecklist` is missing.

- [ ] **Step 6: Implement pure applicability, mapping and aggregation**

Implement `evaluateChecklist` so it:

1. normalizes the procedure;
2. activates `always`, matching `procedure_family`, and exact context-flag rules;
3. maps proposals only by stable item ID;
4. downgrades `captured` or `uncertain` with no valid source to `uncertain`;
5. emits `clinician_required` for empty clinician-only items;
6. aggregates category and overall `answeredCount`, `applicableCount`,
   `blockingGapCount`, and `clinicianRequiredCount`.

```ts
export function checklistBlockers(checklist: EvaluatedChecklist) {
  return checklist.items.filter(
    item =>
      item.required &&
      ["uncertain", "missing", "clinician_required"].includes(item.status)
  );
}
```

- [ ] **Step 7: Run contract tests and type-check**

Run:

```bash
./node_modules/.bin/vitest run packages/contracts/src/checklist.test.ts
npm run typecheck -w @vaanaya/contracts
```

Expected: all checklist tests PASS and type-check exits 0.

- [ ] **Step 8: Export the checklist module and commit**

Add `export * from "./checklist";` to `packages/contracts/src/index.ts`.

```bash
git add packages/contracts/src/checklist.ts packages/contracts/src/checklist.test.ts packages/contracts/src/index.ts
git commit -m "feat: add procedure-aware PAC checklist domain"
```

---

### Task 2: Encounter Contract, Clinician Entry and Sign Gate

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/workflow.test.ts`

**Interfaces:**
- Consumes: `evaluateChecklist` and `checklistBlockers` from Task 1.
- Produces: `withEvaluatedChecklist(encounter: Encounter): Encounter`, `enterChecklistItem(...)`, `deferChecklistItem(...)`, and checklist-driven `signEncounter(...)`.

- [ ] **Step 1: Write failing proposal-source validation tests**

```ts
it("allows clinician-entered content without manufactured transcript evidence", () => {
  expect(() => FieldProposalSchema.parse({
    id: "examination",
    label: "Examination",
    state: "clinician_entered",
    value: "Clinician documented examination",
    sourceTurnIds: [],
    required: true
  })).not.toThrow();
});

it("rejects captured content without source evidence", () => {
  expect(() => FieldProposalSchema.parse({
    id: "medications",
    label: "Medicines",
    state: "captured",
    value: "Tablet",
    sourceTurnIds: [],
    required: true
  })).toThrow();
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `./node_modules/.bin/vitest run packages/contracts/src/workflow.test.ts`

Expected: first test FAILS because `sourceTurnIds` currently requires one item.

- [ ] **Step 3: Replace unconditional source length with state-aware refinement**

```ts
export const FieldProposalSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  state: FieldStateSchema,
  value: z.string(),
  sourceTurnIds: z.array(z.string()),
  required: z.boolean()
}).superRefine((proposal, context) => {
  if (
    ["captured", "uncertain"].includes(proposal.state) &&
    proposal.sourceTurnIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceTurnIds"],
      message: "Captured and uncertain proposals require source evidence."
    });
  }
});
```

- [ ] **Step 4: Write failing encounter mutation and sign tests**

```ts
it("creates a clinician-only entry and recomputes readiness", () => {
  const updated = enterChecklistItem(encounter, {
    itemId: "examination",
    value: "Clinician-entered examination",
    actorId: "clinician-1"
  });
  expect(updated.proposals).toContainEqual(
    expect.objectContaining({
      id: "examination",
      state: "clinician_entered",
      sourceTurnIds: []
    })
  );
  expect(updated.audit.at(-1)?.action).toBe("checklist.item_entered");
});

it("rejects deferral of the clinician conclusion", () => {
  expect(() => deferChecklistItem(encounter, {
    itemId: "clinician_conclusion",
    reason: "Not completed",
    actorId: "clinician-1"
  })).toThrow("cannot be deferred");
});
```

- [ ] **Step 5: Implement checklist context and mutation helpers**

Extend `EncounterSchema` with:

```ts
checklistContext: ChecklistContextSchema.default({
  templateId: "synthetic-pac",
  version: "synthetic-pac-v1",
  contextFlags: []
}),
checklist: EvaluatedChecklistSchema.optional()
```

Implement `withEvaluatedChecklist` by evaluating the encounter and storing the
snapshot. Implement entry and deferral as immutable proposal upserts with audit
events. `resolveProposal` must finish by calling `withEvaluatedChecklist`.

- [ ] **Step 6: Replace `requiredFieldIds` sign logic with checklist blockers**

At the start of `signEncounter`, recompute:

```ts
const evaluated = withEvaluatedChecklist(encounter);
const unresolved = checklistBlockers(evaluated.checklist!);
```

Retain the clinician-role and state-transition checks. Add
`checklistTemplateId` and `checklistVersion` to the `encounter.signed` audit
detail.

- [ ] **Step 7: Run all contract tests and commit**

Run:

```bash
npm test -w @vaanaya/contracts
npm run typecheck -w @vaanaya/contracts
```

Expected: all contract tests PASS and type-check exits 0.

```bash
git add packages/contracts/src/index.ts packages/contracts/src/workflow.test.ts
git commit -m "feat: enforce checklist-driven PAC signoff"
```

---

### Task 3: Synthetic Cohort and Worklist Use One Evaluation

**Files:**
- Modify: `apps/api/src/demo-encounter.ts`
- Modify: `apps/api/src/demo-cohort.ts`
- Modify: `apps/api/src/demo-cohort.test.ts`
- Modify: `apps/api/src/encounter-store.ts`
- Modify: `apps/api/src/encounter-store.test.ts`

**Interfaces:**
- Consumes: `withEvaluatedChecklist`, `normalizeProcedureFamily`.
- Produces: every demo encounter with a current checklist snapshot; worklist counts exactly equal that snapshot.

- [ ] **Step 1: Write failing cohort-family and worklist-equality tests**

```ts
it("covers every selected demo procedure family", () => {
  const families = createDemoEncounters().map(
    encounter => encounter.checklist?.procedureFamily
  );
  expect(new Set(families)).toEqual(new Set([
    "laparoscopic_abdominal", "hysterectomy", "knee_replacement",
    "upper_gi_endoscopy", "urological", "cataract", "breast"
  ]));
});

it("uses evaluated checklist counts in the worklist", () => {
  const encounter = createDemoEncounters()[0]!;
  const item = recordingListItem(encounter);
  expect(item).toMatchObject({
    answeredCount: encounter.checklist?.answeredCount,
    applicableCount: encounter.checklist?.applicableCount,
    criticalGapCount: encounter.checklist?.blockingGapCount
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
./node_modules/.bin/vitest run apps/api/src/demo-cohort.test.ts apps/api/src/encounter-store.test.ts
```

Expected: FAIL because demo encounters have no checklist snapshot.

- [ ] **Step 3: Materialize checklist-aware demo encounters**

Wrap every returned encounter with `withEvaluatedChecklist`. Replace the generic
`focus` proposal IDs with stable checklist item IDs such as `medications`,
`allergies`, `previous_anesthesia`, and modifier IDs. Set Kavya's explicit
pregnancy context flag only in `checklistContext.contextFlags`; do not derive it
from her profile.

- [ ] **Step 4: Replace worklist fallback arithmetic**

In `recordingListItem`, require or compute the evaluated checklist:

```ts
const checklist =
  encounter.checklist ?? withEvaluatedChecklist(encounter).checklist!;
```

Return the checklist totals directly. An uploaded recording therefore shows all
applicable missing requirements rather than a synthetic `1`.

- [ ] **Step 5: Run API unit tests and commit**

Run:

```bash
./node_modules/.bin/vitest run apps/api/src/demo-cohort.test.ts apps/api/src/encounter-store.test.ts
npm run typecheck -w @vaanaya/api
```

Expected: focused tests PASS and type-check exits 0.

```bash
git add apps/api/src/demo-encounter.ts apps/api/src/demo-cohort.ts apps/api/src/demo-cohort.test.ts apps/api/src/encounter-store.ts apps/api/src/encounter-store.test.ts
git commit -m "feat: evaluate procedure checklists for demo recordings"
```

---

### Task 4: Checklist-Constrained Structuring and API Mutations

**Files:**
- Create: `apps/api/src/checklist-proposals.ts`
- Create: `apps/api/src/checklist-proposals.test.ts`
- Modify: `apps/api/src/openai-client.ts`
- Modify: `apps/api/src/openai-client.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: applicable items from `EvaluatedChecklist`, `enterChecklistItem`, `deferChecklistItem`, `withEvaluatedChecklist`.
- Produces: `PacConversationStructure.checklistProposals`,
  `materializeChecklistProposals(...)`,
  `PATCH /api/encounters/:id/checklist/:itemId`, and
  `POST /api/encounters/:id/checklist/:itemId/defer`.

- [ ] **Step 1: Write failing model-boundary tests**

```ts
it("drops unknown model item IDs and invalid source links", () => {
  const proposals = materializeChecklistProposals({
    applicableItems: [{ id: "medications", label: "Medicines", required: true }],
    modelItems: [
      { itemId: "diagnosis", state: "captured", value: "ASA II", sourceTurnIds: ["t1"] },
      { itemId: "medications", state: "captured", value: "Tablet", sourceTurnIds: ["bad"] }
    ],
    transcript: [{ id: "t1" }]
  });
  expect(proposals).toEqual([
    expect.objectContaining({ id: "medications", state: "uncertain" })
  ]);
});
```

- [ ] **Step 2: Verify the model-boundary test fails**

Run: `./node_modules/.bin/vitest run apps/api/src/checklist-proposals.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic proposal materialization**

`materializeChecklistProposals` must:

- emit one proposal for every applicable `evidence_or_clinician` item;
- ignore model item IDs outside that set;
- preserve only source IDs present in the transcript;
- downgrade a source-less captured/uncertain model item to `missing`;
- never generate proposals for clinician-only items;
- copy label and `required` from the template, never from model output.

- [ ] **Step 4: Write and implement the OpenAI request-context test**

Test that `structurePacConversation(segments, checklistItems)` includes only:

```ts
{
  checklistItems: [
    { itemId: "medications", label: "Current or recent medicines" }
  ]
}
```

in the user JSON. Update the system prompt to state that IDs outside this list
are forbidden and that applicability/requirement level are server-controlled.
Keep the existing prohibited inference language.

Extend the structured response with:

```ts
const PacChecklistProposalSchema = z.object({
  itemId: z.string().min(1),
  state: z.enum(["captured", "uncertain"]),
  value: z.string().min(1),
  sourceSegmentIds: z.array(z.string()).min(1)
});

const PacConversationSchema = z.object({
  customerSummary: z.string().min(1),
  turns: z.array(PacConversationTurnSchema),
  checklistProposals: z.array(PacChecklistProposalSchema)
});
```

Filter `checklistProposals` after parsing so every `itemId` exists in the
supplied applicable list and every `sourceSegmentId` exists in the Sarvam
segments. Pass these proposals into `materializeChecklistProposals`; retain
`turns` for speaker and topic mapping.

- [ ] **Step 5: Write failing route tests for entry, deferral and sign blockers**

```ts
it("allows only a clinician to enter a clinician-only item", async () => {
  const response = await server.inject({
    method: "PATCH",
    url: "/api/encounters/demo/checklist/examination",
    headers: clinicianHeaders,
    payload: { value: "Clinician documented examination" }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().checklist.items).toContainEqual(
    expect.objectContaining({ id: "examination", status: "answered" })
  );
});

it("rejects a deferral without a reason", async () => {
  const response = await server.inject({
    method: "POST",
    url: "/api/encounters/demo/checklist/medications/defer",
    headers: clinicianHeaders,
    payload: { reason: "" }
  });
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 6: Implement routes and recompute every response**

Use `request.actor!.id`; ignore caller-supplied actor IDs. Require clinician role
for entry and deferral. Save the mutation and return
`withEvaluatedChecklist(saved)`. Update every processing builder and sign route
to recompute before saving. In `encounterFromDiarizedRecording`, replace the
single hardcoded medicines proposal with `materializeChecklistProposals` using
`structure.checklistProposals` and the generated transcript.

- [ ] **Step 7: Run API tests and commit**

Run:

```bash
npm test -w @vaanaya/api
npm run typecheck -w @vaanaya/api
```

Expected: all API tests PASS and type-check exits 0.

```bash
git add apps/api/src/checklist-proposals.ts apps/api/src/checklist-proposals.test.ts apps/api/src/openai-client.ts apps/api/src/openai-client.test.ts apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat: constrain PAC structuring to applicable checklist items"
```

---

### Task 5: Supabase Checklist Version and Source-Safe Reload

**Files:**
- Modify: `apps/api/src/supabase-encounter-store.ts`
- Modify: `apps/api/src/supabase-encounter-store.test.ts`
- Create: the exact migration path emitted by
  `supabase migration new store_pac_checklist_context`

**Interfaces:**
- Consumes: encounter checklist context and `withEvaluatedChecklist`.
- Produces: Supabase save/reload with checklist version, procedure family and context flags.

- [ ] **Step 1: Read current Supabase migration documentation**

Open current official Supabase database migration guidance and changelog before
changing schema. Record no secrets in output.

- [ ] **Step 2: Write failing mapping tests**

Use a fake Supabase client to verify that a loaded encounter receives:

```ts
{
  checklistContext: {
    templateId: "synthetic-pac",
    version: "synthetic-pac-v1",
    contextFlags: []
  },
  checklist: expect.objectContaining({
    procedureFamily: "laparoscopic_abdominal"
  })
}
```

Also verify signed-note content contains `synthetic-pac-v1`.

- [ ] **Step 3: Run the store test and verify failure**

Run: `./node_modules/.bin/vitest run apps/api/src/supabase-encounter-store.test.ts`

Expected: FAIL because checklist context is not mapped.

- [ ] **Step 4: Generate and write the migration**

Run:

```bash
supabase migration new store_pac_checklist_context
```

Use the emitted filename; do not invent a timestamp. Add:

```sql
alter table public.encounters
  add column checklist_template_id text not null default 'synthetic-pac',
  add column checklist_version text not null default 'synthetic-pac-v1',
  add column checklist_context_flags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checklist_context_flags) = 'array');
```

- [ ] **Step 5: Implement read/write mapping**

Select the three new columns in `encounterRow`, map them into
`checklistContext`, and call `withEvaluatedChecklist` after `EncounterSchema`
parsing. Update the encounter row only when context changes. Signed note content
already stores the whole evaluated encounter; assert that behavior.

- [ ] **Step 6: Verify store tests and attempt the local schema gate**

Run:

```bash
./node_modules/.bin/vitest run apps/api/src/supabase-encounter-store.test.ts
npm run typecheck -w @vaanaya/api
supabase db lint --local
```

Expected: tests and type-check PASS. Database lint PASS when local Supabase is
running; otherwise record the exact environment blocker without claiming lint
success.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/supabase-encounter-store.ts apps/api/src/supabase-encounter-store.test.ts supabase/migrations
git commit -m "feat: persist PAC checklist context"
```

---

### Task 6: Accessible Category Checklist UI

**Files:**
- Create: `apps/web/src/PacChecklist.tsx`
- Create: `apps/web/src/PacChecklist.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `encounter.checklist`, entry/defer API functions and `onSelectSources(sourceTurnIds: string[])`.
- Produces: accessible category disclosures with a single expanded category on narrow screens and the existing Evidence Rail highlight behavior.

- [ ] **Step 1: Write failing category rendering test**

```tsx
render(
  <PacChecklist
    checklist={checklist}
    onSelectItem={vi.fn()}
    onEnterItem={vi.fn()}
    onDeferItem={vi.fn()}
  />
);
expect(screen.getByText("Synthetic checklist — clinician validation pending"))
  .toBeInTheDocument();
expect(screen.getByRole("button", { name: /Medicines.*1 of 3 answered.*2 gaps/i }))
  .toHaveAttribute("aria-expanded", "true");
expect(screen.getByText("Current or recent medicines")).toBeVisible();
```

- [ ] **Step 2: Run the component test and verify failure**

Run: `./node_modules/.bin/vitest run apps/web/src/PacChecklist.test.tsx`

Expected: FAIL because `PacChecklist` does not exist.

- [ ] **Step 3: Implement the category component**

Use native buttons with `aria-expanded` and `aria-controls`. Initialize the open
category to the first category with `blockingGapCount > 0`, otherwise the first
category. Render text labels for every state and render source buttons only
when `sourceTurnIds.length > 0`.

The component props are:

```ts
type PacChecklistProps = {
  checklist: EvaluatedChecklist;
  selectedItemId: string | null;
  onSelectItem(itemId: string): void;
  onEnterItem(itemId: string, value: string): void;
  onDeferItem(itemId: string, reason: string): void;
};
```

- [ ] **Step 4: Write and implement API client tests**

Add:

```ts
enterChecklistItemRequest(encounterId: string, itemId: string, value: string)
deferChecklistItemRequest(encounterId: string, itemId: string, reason: string)
```

Test exact PATCH/POST URLs, JSON bodies and `EncounterSchema` parsing.

- [ ] **Step 5: Replace the flat list in `App.tsx`**

Remove client-computed `unresolvedRequired`. Render `PacChecklist` using the
server snapshot. Selecting an item sets `selectedField`; the existing
`sourceIds` calculation continues to highlight Evidence Rail turns. Disable
signing with `encounter.checklist?.readyForSignoff !== true`.

Keep the existing clarification drawer, but make its heading and guidance come
from the selected checklist item instead of always saying “Confirm the exact
medicine.”

- [ ] **Step 6: Add responsive and accessible styles**

Add `.pac-category`, `.pac-category-trigger`, `.pac-checklist-item`,
`.checklist-validation-badge`, and state modifier classes. At widths below
`760px`, stack counts below the category label without hiding them. Preserve
visible focus styles.

- [ ] **Step 7: Run web tests, type-check and commit**

Run:

```bash
npm test -w @vaanaya/web
npm run typecheck -w @vaanaya/web
```

Expected: all web tests PASS and type-check exits 0.

```bash
git add apps/web/src/PacChecklist.tsx apps/web/src/PacChecklist.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/styles.css
git commit -m "feat: group PAC completeness by category"
```

---

### Task 7: End-to-End Verification and Source-of-Truth Handoff

**Files:**
- Modify: `docs/qa/2026-07-26-code-rca.md`

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: verified buildathon demo and accurate remaining-risk documentation.

- [ ] **Step 1: Run the complete automated release gate**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run simulate:scenarios
git diff --check
```

Expected: every command exits 0; the test output contains no failures.

- [ ] **Step 2: Run the live internal-browser acceptance path**

Against `http://10.206.10.212:5173/`:

1. open Recordings;
2. verify all ten records show procedure-derived counts;
3. open Shantanu;
4. verify the synthetic-validation label;
5. verify the first blocking category is expanded;
6. open Medicines and select the blood-thinner item;
7. verify the Hindi statement containing `naam yaad nahi` is highlighted;
8. verify signing is disabled;
9. enter a neutral clinician-confirmed value;
10. verify counts update while the original Evidence Rail turn remains;
11. complete any remaining clinician-only synthetic demo entries;
12. sign and verify the signed state.

Capture browser console errors and failed network requests. Expected: none.

- [ ] **Step 3: Update the QA/RCA document with observed evidence**

Record:

- exact test counts;
- live procedure families exercised;
- the Shantanu evidence and sign-blocker result;
- Supabase lint/migration status;
- the continuing “synthetic checklist — clinician validation pending”
  boundary;
- any deviations from this plan.

- [ ] **Step 4: Commit the verified handoff**

```bash
git add docs/qa/2026-07-26-code-rca.md
git commit -m "docs: verify procedure-aware PAC checklist"
```

- [ ] **Step 5: Request code review before integration**

Use `superpowers:requesting-code-review`, address evidence-backed findings, then
rerun the complete release gate before any push or merge.
