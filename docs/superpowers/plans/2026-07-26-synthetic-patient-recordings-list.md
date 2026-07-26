# Synthetic Patient Recordings List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed a clinically varied ten-patient synthetic cohort and add a recordings-first clinician worklist ordered by processing priority and recording time.

**Architecture:** The contracts package owns the worklist response schema. The API encounter store owns cohort data and deterministic ordering, and exposes it through one authenticated endpoint. A focused React `RecordingsPage` renders the worklist and delegates encounter review to the existing `App` Evidence Rail.

**Tech Stack:** TypeScript 5, Zod, Fastify, React 19, Vitest, Testing Library, Supabase-compatible encounter store interfaces.

## Global Constraints

- Every seeded person, mobile number, conversation, and PAC record is synthetic.
- The interface must visibly label the cohort as synthetic demo data.
- PAC requirements are determined by procedure and applicable clinical context, not by gender alone.
- The product does not determine anesthetic fitness, assign ASA grade, diagnose, prescribe, or sign for a clinician.
- Pregnancy-related questions appear only when clinically applicable and may be explicitly marked not applicable; the system must not infer an answer.
- Worklist order is unprocessed uploads first, newest first within that group, followed by all other recordings newest first.
- Selecting a recording opens the existing encounter review and Evidence Rail.
- Stored recordings must reuse stored transcripts and skip Sarvam and OpenAI.

---

### Task 1: Define the recordings worklist contract

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/workflow.test.ts`

**Interfaces:**
- Consumes: existing `PatientSummarySchema` and `EncounterStateSchema`
- Produces: `RecordingStatusSchema`, `RecordingListItemSchema`, `RecordingListSchema`, `RecordingStatus`, and `RecordingListItem`

- [ ] **Step 1: Write the failing contract test**

Add this test to `packages/contracts/src/workflow.test.ts`:

```ts
import { RecordingListSchema } from "./index";

it("validates an evidence-backed synthetic recording list item", () => {
  expect(
    RecordingListSchema.parse([
      {
        encounterId: "synthetic-shantanu",
        patient: {
          id: "patient-shantanu",
          displayName: "Shantanu Chandra",
          mobileNumber: "+919811110001",
          mobileLast4: "0001"
        },
        synthetic: true,
        procedure: "Laparoscopic hernia repair",
        preferredLanguage: "hi-IN",
        recordedAt: "2026-07-26T08:30:00.000Z",
        status: "uploaded",
        answeredCount: 2,
        applicableCount: 4,
        criticalGapCount: 1,
        hasTranscript: false
      }
    ])
  ).toHaveLength(1);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
npm test -w @vaanaya/contracts -- src/workflow.test.ts
```

Expected: FAIL because `RecordingListSchema` is not exported.

- [ ] **Step 3: Add the minimal Zod schemas**

Add to `packages/contracts/src/index.ts` after `PatientSummarySchema`:

```ts
export const RecordingStatusSchema = z.enum([
  "uploaded",
  "processing",
  "ready_for_review",
  "signed",
  "failed"
]);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

export const RecordingListItemSchema = z.object({
  encounterId: z.string().min(1),
  patient: PatientSummarySchema,
  synthetic: z.literal(true),
  procedure: z.string().min(1),
  preferredLanguage: z.string().min(2),
  recordedAt: z.string().datetime(),
  status: RecordingStatusSchema,
  answeredCount: z.number().int().nonnegative(),
  applicableCount: z.number().int().positive(),
  criticalGapCount: z.number().int().nonnegative(),
  hasTranscript: z.boolean()
});
export type RecordingListItem = z.infer<typeof RecordingListItemSchema>;
export const RecordingListSchema = z.array(RecordingListItemSchema);
```

- [ ] **Step 4: Run the contract test and verify GREEN**

Run:

```bash
npm test -w @vaanaya/contracts -- src/workflow.test.ts
```

Expected: all contract tests PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/workflow.test.ts
git commit -m "feat: define recordings worklist contract"
```

---

### Task 2: Seed the ten-patient synthetic PAC cohort

**Files:**
- Create: `apps/api/src/demo-cohort.ts`
- Create: `apps/api/src/demo-cohort.test.ts`
- Modify: `apps/api/src/demo-encounter.ts`

**Interfaces:**
- Consumes: `Encounter` and `EncounterSchema` from `@vaanaya/contracts`
- Produces: `createDemoEncounters(): Encounter[]`; `createDemoEncounter()` returns the Shantanu encounter with ID `demo` for backward-compatible demo routing

- [ ] **Step 1: Write the failing cohort test**

Create `apps/api/src/demo-cohort.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDemoEncounters } from "./demo-cohort";

describe("synthetic PAC cohort", () => {
  it("contains ten labelled patients with unique fictional contacts and varied procedures", () => {
    const encounters = createDemoEncounters();
    expect(encounters).toHaveLength(10);
    expect(encounters.map(item => item.patient?.displayName)).toEqual([
      "Shantanu Chandra",
      "Udayan Walvekar",
      "Abhishek Patil",
      "Ameeth Dubey",
      "Rajnish Kumar",
      "Ananya Rao",
      "Meera Kulkarni",
      "Kavya Nair",
      "Priya Deshmukh",
      "Nandini Iyer"
    ]);
    expect(new Set(encounters.map(item => item.patient?.mobileNumber)).size).toBe(10);
    expect(encounters.every(item => item.audit[0]?.detail.syntheticDemo === true)).toBe(true);
    expect(encounters.find(item => item.patient?.displayName === "Ananya Rao")?.procedure)
      .toBe("Laparoscopic hysterectomy");
    expect(encounters.find(item => item.patient?.displayName === "Shantanu Chandra")?.procedure)
      .toBe("Laparoscopic hernia repair");
  });
});
```

- [ ] **Step 2: Run the cohort test and verify RED**

Run:

```bash
npm test -w @vaanaya/api -- src/demo-cohort.test.ts
```

Expected: FAIL because `demo-cohort.ts` does not exist.

- [ ] **Step 3: Implement a data-driven cohort factory**

Create `apps/api/src/demo-cohort.ts` with:

```ts
type DemoProfile = {
  id: string;
  name: string;
  mobileNumber: string;
  procedure: string;
  preferredLanguage: "hi-IN" | "en-IN" | "kn-IN";
  recordedAt: string;
  state: Encounter["state"];
  focusLabel: string;
  focusState: "captured" | "uncertain" | "missing";
  focusValue: string;
};

const profiles: DemoProfile[] = [
  {
    id: "demo",
    name: "Shantanu Chandra",
    mobileNumber: "+919811110001",
    procedure: "Laparoscopic hernia repair",
    preferredLanguage: "hi-IN",
    recordedAt: "2026-07-26T08:30:00.000Z",
    state: "clinician_review",
    focusLabel: "Hypertension medicines",
    focusState: "uncertain",
    focusValue: "Medicine name requires verification from the strip."
  },
  {
    id: "synthetic-udayan",
    name: "Udayan Walvekar",
    mobileNumber: "+919811110002",
    procedure: "Knee replacement",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T08:45:00.000Z",
    state: "clinician_review",
    focusLabel: "Diabetes medicines and functional capacity",
    focusState: "missing",
    focusValue: "Diabetes medicine timing and stair-climbing tolerance were not discussed."
  },
  {
    id: "synthetic-abhishek",
    name: "Abhishek Patil",
    mobileNumber: "+919811110003",
    procedure: "Upper GI endoscopy",
    preferredLanguage: "hi-IN",
    recordedAt: "2026-07-26T09:00:00.000Z",
    state: "clinician_review",
    focusLabel: "Allergies",
    focusState: "uncertain",
    focusValue: "The allergy response was discussed but remained unclear."
  },
  {
    id: "synthetic-ameeth",
    name: "Ameeth Dubey",
    mobileNumber: "+919811110004",
    procedure: "Transurethral urological procedure",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T09:15:00.000Z",
    state: "recording",
    focusLabel: "Previous anesthesia",
    focusState: "missing",
    focusValue: "Previous-anesthesia history was not discussed."
  },
  {
    id: "synthetic-rajnish",
    name: "Rajnish Kumar",
    mobileNumber: "+919811110005",
    procedure: "Cataract surgery",
    preferredLanguage: "hi-IN",
    recordedAt: "2026-07-26T09:30:00.000Z",
    state: "clinician_review",
    focusLabel: "Blood thinner",
    focusState: "uncertain",
    focusValue: "Blood-thinner name and last dose were not reliably captured."
  },
  {
    id: "synthetic-ananya",
    name: "Ananya Rao",
    mobileNumber: "+919811110006",
    procedure: "Laparoscopic hysterectomy",
    preferredLanguage: "kn-IN",
    recordedAt: "2026-07-26T09:45:00.000Z",
    state: "clinician_review",
    focusLabel: "Bleeding history and anaemia evidence",
    focusState: "captured",
    focusValue: "Bleeding history was captured; investigation evidence remains for clinician review."
  },
  {
    id: "synthetic-meera",
    name: "Meera Kulkarni",
    mobileNumber: "+919811110007",
    procedure: "Breast surgery",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T10:00:00.000Z",
    state: "signed",
    focusLabel: "Medicines, allergies, and previous anesthesia",
    focusState: "captured",
    focusValue: "Required history was captured and clinician-confirmed."
  },
  {
    id: "synthetic-kavya",
    name: "Kavya Nair",
    mobileNumber: "+919811110008",
    procedure: "Laparoscopic cholecystectomy",
    preferredLanguage: "kn-IN",
    recordedAt: "2026-07-26T10:15:00.000Z",
    state: "recording",
    focusLabel: "Applicable pregnancy question and recent symptoms",
    focusState: "missing",
    focusValue: "Applicable pregnancy question and recent symptoms were not discussed."
  },
  {
    id: "synthetic-priya",
    name: "Priya Deshmukh",
    mobileNumber: "+919811110009",
    procedure: "Knee replacement",
    preferredLanguage: "hi-IN",
    recordedAt: "2026-07-26T10:30:00.000Z",
    state: "processing",
    focusLabel: "Diabetes, functional capacity, and medicines",
    focusState: "uncertain",
    focusValue: "Medication reconciliation is awaiting processing completion."
  },
  {
    id: "synthetic-nandini",
    name: "Nandini Iyer",
    mobileNumber: "+919811110010",
    procedure: "Upper GI endoscopy",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T10:45:00.000Z",
    state: "clinician_review",
    focusLabel: "Fasting discussion and reflux history",
    focusState: "captured",
    focusValue: "Fasting discussion and reflux history were captured for clinician review."
  }
];
```

For each profile, return an `EncounterSchema.parse(...)` value containing:

- patient ID `patient-${profile.id}`;
- `patientReference` equal to the synthetic patient name;
- a source-linked `focus` proposal;
- a patient transcript turn for `captured` or `uncertain` profiles;
- a clinician question turn for processed `missing` profiles, preserving
  evidence that the question lacks a patient answer;
- no proposals and no transcript for `uploaded`/`recording` profiles;
- an audit event `synthetic_demo_seeded` with `syntheticDemo: true`,
  `recordedAt`, and `pacFocus`;
- no pregnancy field for male profiles;
- `pregnancyQuestionApplicable: true` in Kavya Nair's seed audit, without a
  proposal or inferred answer until that recording is processed.

For Shantanu, retain the existing detailed source transcript, change the
patient identity and procedure consistently, and change the medicines proposal
copy to the hypertension-medicine verification focus. For the other processed
profiles, create a single patient turn whose ID is the `sourceTurnIds` entry of
the `focus` proposal. For `recording` profiles, use no proposals and no
transcript; their focus remains metadata in the seed audit until processing.

- [ ] **Step 4: Make the legacy factory delegate to the cohort**

Replace `apps/api/src/demo-encounter.ts` with:

```ts
import type { Encounter } from "@vaanaya/contracts";
import { createDemoEncounters } from "./demo-cohort";

export function createDemoEncounter(): Encounter {
  const encounter = createDemoEncounters().find(item => item.id === "demo");
  if (!encounter) throw new Error("Synthetic demo encounter is missing.");
  return encounter;
}
```

- [ ] **Step 5: Run cohort and existing API tests**

Run:

```bash
npm test -w @vaanaya/api -- src/demo-cohort.test.ts src/server.test.ts
```

Expected: PASS; update existing literals from Ravi Kumar to Shantanu Chandra
only where the test consumes the default `demo` encounter.

- [ ] **Step 6: Commit the cohort**

```bash
git add apps/api/src/demo-cohort.ts apps/api/src/demo-cohort.test.ts apps/api/src/demo-encounter.ts apps/api/src/server.test.ts
git commit -m "feat: seed synthetic PAC patient cohort"
```

---

### Task 3: Add store-owned worklist ordering

**Files:**
- Modify: `apps/api/src/encounter-store.ts`
- Create: `apps/api/src/encounter-store.test.ts`
- Modify: `apps/api/src/supabase-encounter-store.ts`

**Interfaces:**
- Consumes: `RecordingListItem` and stored `Encounter` values
- Produces: `EncounterStore.listRecordings(input: { organizationId: string }): Promise<RecordingListItem[]>`; `recordingListItem(encounter: Encounter): RecordingListItem`; `sortRecordingList(items: RecordingListItem[]): RecordingListItem[]`

- [ ] **Step 1: Write the failing ordering test**

Create `apps/api/src/encounter-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryEncounterStore } from "./encounter-store";
import { createDemoEncounters } from "./demo-cohort";

describe("recordings worklist", () => {
  it("pins unprocessed uploads before newer processed recordings", async () => {
    const store = new MemoryEncounterStore(createDemoEncounters());
    const items = await store.listRecordings({ organizationId: "org-1" });
    const firstProcessedIndex = items.findIndex(item => item.status !== "uploaded");
    expect(firstProcessedIndex).toBeGreaterThan(0);
    expect(items.slice(0, firstProcessedIndex).every(item => item.status === "uploaded"))
      .toBe(true);
    expect(items).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run the store test and verify RED**

Run:

```bash
npm test -w @vaanaya/api -- src/encounter-store.test.ts
```

Expected: FAIL because `listRecordings` is not defined.

- [ ] **Step 3: Implement status, counts, and ordering**

In `apps/api/src/encounter-store.ts`:

```ts
function recordingStatus(encounter: Encounter): RecordingStatus {
  const failed = encounter.audit.some(event => event.action === "recording.processing_failed");
  if (failed) return "failed";
  if (encounter.state === "signed" || encounter.state === "summary_approved" || encounter.state === "shared")
    return "signed";
  if (encounter.state === "processing") return "processing";
  if (encounter.state === "clinician_review") return "ready_for_review";
  return "uploaded";
}

export function recordingListItem(encounter: Encounter): RecordingListItem {
  const patient = encounter.patient;
  if (!patient) throw new Error("A recording list item requires a patient.");
  const recordedAt = encounter.audit
    .map(event => event.detail.recordedAt)
    .find((value): value is string => typeof value === "string")
    ?? encounter.audit[0]?.occurredAt
    ?? "2026-07-26T00:00:00.000Z";
  const applicable = encounter.proposals.filter(item => item.required);
  return {
    encounterId: encounter.id,
    patient,
    synthetic: true,
    procedure: encounter.procedure,
    preferredLanguage: encounter.preferredLanguage,
    recordedAt,
    status: recordingStatus(encounter),
    answeredCount: applicable.filter(item =>
      ["captured", "clinician_entered", "intentionally_skipped"].includes(item.state)
    ).length,
    applicableCount: Math.max(1, applicable.length),
    criticalGapCount: applicable.filter(item =>
      ["uncertain", "missing"].includes(item.state)
    ).length,
    hasTranscript: encounter.transcript.length > 0
  };
}
```

Implement `sortRecordingList` with an uploaded priority of `0`, every other
status priority `1`, and descending `Date.parse(recordedAt)` inside each
priority. Implement `MemoryEncounterStore.listRecordings()` by mapping its
encounters through these functions.

Add the method to `EncounterStore`. For this MVP, implement
`SupabaseEncounterStore.listRecordings()` as:

```ts
async listRecordings(): Promise<RecordingListItem[]> {
  throw new Error(
    "The recordings worklist requires the longitudinal patient schema; use deterministic demo mode."
  );
}
```

Do not add a schema migration in this task. The production endpoint must turn
this specific adapter error into HTTP `503` with code
`RECORDINGS_WORKLIST_UNAVAILABLE`, while deterministic demo mode returns the
complete cohort.

- [ ] **Step 4: Run store tests and verify GREEN**

Run:

```bash
npm test -w @vaanaya/api -- src/encounter-store.test.ts src/supabase-encounter-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit store behavior**

```bash
git add apps/api/src/encounter-store.ts apps/api/src/encounter-store.test.ts apps/api/src/supabase-encounter-store.ts
git commit -m "feat: order synthetic recording worklist"
```

---

### Task 4: Expose the authenticated recordings endpoint

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: `EncounterStore.listRecordings`
- Produces: authenticated `GET /api/recordings`

- [ ] **Step 1: Write the failing route test**

Add to `apps/api/src/server.test.ts`:

```ts
it("returns the synthetic recordings worklist in processing priority order", async () => {
  const server = await buildServer({ authenticator: testAuthenticator });
  servers.push(server);
  const response = await server.inject({
    method: "GET",
    url: "/api/recordings",
    headers: authorized
  });
  expect(response.statusCode).toBe(200);
  const items = response.json();
  expect(items).toHaveLength(10);
  expect(items[0]).toMatchObject({ synthetic: true, status: "uploaded" });
  expect(items.map((item: { patient: { displayName: string } }) => item.patient.displayName))
    .toContain("Ananya Rao");
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run:

```bash
npm test -w @vaanaya/api -- src/server.test.ts
```

Expected: FAIL with HTTP 404 for `/api/recordings`.

- [ ] **Step 3: Seed the full cohort and add the route**

Change the default store construction in `apps/api/src/server.ts`:

```ts
new MemoryEncounterStore(createDemoEncounters())
```

Add:

```ts
server.get("/api/recordings", async (request, reply) => {
  try {
    return await store.listRecordings({
      organizationId: request.actor!.organizationId
    });
  } catch (error) {
    request.log.error({ error }, "Recordings worklist unavailable");
    return reply.code(503).send({
      code: "RECORDINGS_WORKLIST_UNAVAILABLE",
      message: "The recordings worklist is unavailable in this storage mode."
    });
  }
});
```

- [ ] **Step 4: Run API tests and verify GREEN**

Run:

```bash
npm test -w @vaanaya/api -- src/server.test.ts
```

Expected: all API route tests PASS.

- [ ] **Step 5: Commit the endpoint**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat: expose recordings worklist API"
```

---

### Task 5: Add the typed web API client

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

**Interfaces:**
- Consumes: `RecordingListSchema`
- Produces: `getRecordings(): Promise<RecordingListItem[]>`

- [ ] **Step 1: Write the failing API-client test**

Add to `apps/web/src/api.test.ts`:

```ts
it("loads and validates the recordings worklist", async () => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => [{
      encounterId: "synthetic-shantanu",
      patient: {
        id: "patient-shantanu",
        displayName: "Shantanu Chandra",
        mobileNumber: "+919811110001",
        mobileLast4: "0001"
      },
      synthetic: true,
      procedure: "Laparoscopic hernia repair",
      preferredLanguage: "hi-IN",
      recordedAt: "2026-07-26T08:30:00.000Z",
      status: "uploaded",
      answeredCount: 2,
      applicableCount: 4,
      criticalGapCount: 1,
      hasTranscript: false
    }]
  } as Response);
  await expect(getRecordings()).resolves.toHaveLength(1);
});
```

- [ ] **Step 2: Run the client test and verify RED**

Run:

```bash
npm test -w @vaanaya/web -- src/api.test.ts
```

Expected: FAIL because `getRecordings` is not exported.

- [ ] **Step 3: Implement the client**

In `apps/web/src/api.ts`:

```ts
export async function getRecordings(): Promise<RecordingListItem[]> {
  const response = await protectedFetch(`${API_BASE}/api/recordings`);
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Recordings could not be loaded.");
  return RecordingListSchema.parse(payload);
}
```

Import `RecordingListSchema` and `RecordingListItem`.

- [ ] **Step 4: Run the client test and verify GREEN**

Run:

```bash
npm test -w @vaanaya/web -- src/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the client**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat: load typed recording worklist"
```

---

### Task 6: Build the recordings page

**Files:**
- Create: `apps/web/src/RecordingsPage.tsx`
- Create: `apps/web/src/RecordingsPage.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `RecordingListItem[]`
- Produces: `RecordingsPage({ recordings, loading, onOpen, onProcess }: Props)`

- [ ] **Step 1: Write the failing component test**

Create `apps/web/src/RecordingsPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecordingsPage } from "./RecordingsPage";

it("shows synthetic recording status and opens existing evidence review", async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(
    <RecordingsPage
      loading={false}
      recordings={[{
        encounterId: "demo",
        patient: {
          id: "patient-demo",
          displayName: "Shantanu Chandra",
          mobileNumber: "+919811110001",
          mobileLast4: "0001"
        },
        synthetic: true,
        procedure: "Laparoscopic hernia repair",
        preferredLanguage: "hi-IN",
        recordedAt: "2026-07-26T08:30:00.000Z",
        status: "ready_for_review",
        answeredCount: 3,
        applicableCount: 4,
        criticalGapCount: 1,
        hasTranscript: true
      }]}
      onOpen={onOpen}
      onProcess={vi.fn()}
    />
  );
  expect(screen.getByText("Synthetic demo data")).toBeInTheDocument();
  expect(screen.getByText("3 of 4 answered")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /continue review.*shantanu/i }));
  expect(onOpen).toHaveBeenCalledWith("demo");
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npm test -w @vaanaya/web -- src/RecordingsPage.test.tsx
```

Expected: FAIL because `RecordingsPage` does not exist.

- [ ] **Step 3: Implement the focused component**

Create `apps/web/src/RecordingsPage.tsx`:

```tsx
type Props = {
  recordings: RecordingListItem[];
  loading: boolean;
  onOpen(encounterId: string): void;
  onProcess(encounterId: string): void;
};
```

Render:

- heading `Recordings`;
- visible banner `Synthetic demo data`;
- loading text `Loading recordings…`;
- empty text `No recordings are available.`;
- one semantic `<article>` per item;
- patient, procedure, localized timestamp, language, textual status;
- `${answeredCount} of ${applicableCount} answered`;
- `${criticalGapCount} critical gaps`;
- `Process recording` for `uploaded`;
- `Retry` for `failed`;
- `Continue review` for `ready_for_review`;
- `Open evidence` for `processing` when `hasTranscript` is true;
- `View signed note` for `signed`.

All action accessible names must append the patient name.

- [ ] **Step 4: Add responsive worklist styles**

In `apps/web/src/styles.css`, add `.recordings-page`,
`.recordings-toolbar`, `.recording-list`, `.recording-list-item`,
`.recording-patient`, `.recording-metrics`, and `.recording-status-*`.
Use existing color variables, visible focus styles, text status labels, and a
single-column card layout below `760px`.

- [ ] **Step 5: Run the component test and verify GREEN**

Run:

```bash
npm test -w @vaanaya/web -- src/RecordingsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the page**

```bash
git add apps/web/src/RecordingsPage.tsx apps/web/src/RecordingsPage.test.tsx apps/web/src/styles.css
git commit -m "feat: build synthetic recordings page"
```

---

### Task 7: Integrate navigation and encounter handoff

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `getRecordings`, `getEncounter`, and `RecordingsPage`
- Produces: in-app `Review workspace` and `Recordings` destinations without duplicating the Evidence Rail

- [ ] **Step 1: Write the failing navigation test**

Add to `apps/web/src/App.test.tsx`:

```tsx
it("opens a recording from the worklist in the existing evidence rail", async () => {
  const user = userEvent.setup();
  const shantanuEncounter = {
    ...demoEncounter,
    patient: {
      id: "patient-demo",
      displayName: "Shantanu Chandra",
      mobileNumber: "+919811110001",
      mobileLast4: "0001"
    },
    patientReference: "Shantanu Chandra",
    procedure: "Laparoscopic hernia repair"
  };
  vi.mocked(fetch).mockImplementation(async input => {
    const url = String(input);
    if (url.includes("/api/recordings")) {
      return {
        ok: true,
        json: async () => [{
          encounterId: "demo",
          patient: shantanuEncounter.patient,
          synthetic: true,
          procedure: shantanuEncounter.procedure,
          preferredLanguage: "hi-IN",
          recordedAt: "2026-07-26T08:30:00.000Z",
          status: "ready_for_review",
          answeredCount: 3,
          applicableCount: 4,
          criticalGapCount: 1,
          hasTranscript: true
        }]
      } as Response;
    }
    if (url.includes("/api/encounters/demo")) {
      return { ok: true, json: async () => shantanuEncounter } as Response;
    }
    if (url.includes("/api/patients")) {
      return {
        ok: true,
        json: async () => [shantanuEncounter.patient]
      } as Response;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Recordings" }));
  expect(await screen.findByRole("heading", { name: "Recordings" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", {
    name: /continue review.*shantanu chandra/i
  }));
  expect(await screen.findByRole("heading", {
    name: "Listen once. Verify precisely."
  })).toBeInTheDocument();
  expect(screen.getByText("Shantanu Chandra")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the App test and verify RED**

Run:

```bash
npm test -w @vaanaya/web -- src/App.test.tsx
```

Expected: FAIL because the `Recordings` destination is absent.

- [ ] **Step 3: Integrate page state and data loading**

In `apps/web/src/App.tsx`:

```ts
const [page, setPage] = useState<"review" | "recordings">("review");
const [recordings, setRecordings] = useState<RecordingListItem[]>([]);
const [recordingsLoading, setRecordingsLoading] = useState(false);
```

Add header navigation buttons. When `Recordings` is selected, call
`getRecordings()` and render `RecordingsPage`.

Implement:

```ts
async function openRecording(encounterId: string) {
  setBusy(true);
  try {
    const selected = await getEncounter(encounterId);
    setEncounter(selected);
    setSelectedPatient(selected.patient ?? null);
    setSelectedField(selected.proposals[0]?.id ?? null);
    setPage("review");
  } finally {
    setBusy(false);
  }
}
```

For `onProcess`, call the existing complete recording operation only for the
fixed demo recording route, refresh the worklist afterward, and open the
returned encounter. Do not imply arbitrary uploaded files are supported.

- [ ] **Step 4: Run App tests and verify GREEN**

Run:

```bash
npm test -w @vaanaya/web -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit integration**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: connect recordings list to evidence review"
```

---

### Task 8: Verify the complete workflow

**Files:**
- Modify only if verification exposes a defect in files already listed above

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified buildathon-ready recordings workflow

- [ ] **Step 1: Run the complete automated suite**

```bash
npm test
```

Expected: all API, web, contract, and 1000-case corpus tests PASS.

- [ ] **Step 2: Run type-check and production build**

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`. The existing Vite chunk-size warning is
non-blocking; no TypeScript or build error is allowed.

- [ ] **Step 3: Validate the worktree**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Preserve unrelated user files under
`Examples/` and `.superpowers/`; do not stage them.

- [ ] **Step 4: Run the browser acceptance flow**

Use the in-app browser:

1. Sign in as `suruchi.patel@artemis.com`.
2. Open `Recordings`.
3. Confirm ten synthetic patients are visible.
4. Confirm uploaded items are first and processed items are newest-first.
5. Open Shantanu Chandra and verify the existing Evidence Rail appears.
6. Open Ananya Rao and verify the hysterectomy procedure and applicable PAC
   focus are displayed.
7. Confirm status, completion, and critical gaps are readable on a narrow
   viewport.

Expected: all seven checks succeed with no console or network error.

- [ ] **Step 5: Commit verification fixes, if any**

```bash
git add apps/api/src apps/web/src packages/contracts/src
git commit -m "fix: complete recordings workflow verification"
```

Skip this commit when verification required no code changes.
