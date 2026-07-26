# Vaanaya Longitudinal PAC MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a longitudinal PAC workflow where a clinician can add or select a patient, run a live or uploaded MP4 encounter, review previous conversations, resolve field-level merge conflicts against the latest signed PAC, and sign a new immutable PAC version.

**Architecture:** Extend the existing `Encounter`-driven API and React review workspace rather than introducing a second application shell. Store authoritative patient identity and encounter lineage in Supabase, run live and uploaded audio through one ingestion contract, and keep voice biometrics advisory-only with explicit clinician acknowledgement on uncertain or mismatched comparisons.

**Tech Stack:** Fastify, React 19, TypeScript, Vitest, Supabase Postgres/Auth/Storage, `@supabase/supabase-js`, existing Sarvam transcription adapter

## Global Constraints

- Within an organization, the normalized mobile number and normalized name form the authoritative returning-patient lookup key.
- The respondent is selected once per encounter and is always `patient` for this MVP.
- Voice matching assists the doctor but does not establish identity or block access.
- Name plus mobile number remain authoritative, and the doctor may acknowledge the warning and continue.
- MP4 validation rejects files with no usable audio track. The MVP does not process video frames.
- A signed PAC is immutable. A returning visit creates a new encounter linked to the latest signed PAC; it never overwrites the older record.
- Unchanged fields appear as carried forward and remain individually reviewable. They do not require a merge decision.
- Sign-off is disabled until all required uncertainty and every conflict is resolved.
- The product must visibly label voice matching as MVP identity assistance rather than authentication.

---

## File Structure

- `packages/contracts/src/index.ts`
  Extend the shared encounter schema with patient identity, recording metadata, voice-match status, previous encounter lineage, merge conflicts, and previous conversation summaries.
- `packages/contracts/src/workflow.test.ts`
  Lock the new signing and merge-resolution rules at the contract layer before API work starts.
- `supabase/migrations/*_longitudinal_pac_mvp.sql`
  Add patient, voice profile, recording, encounter-lineage, transcript-link, and merge-decision tables plus RLS/policies/indexes.
- `scripts/seed-demo.mjs`
  Seed one returning synthetic patient with a signed historical PAC and one current draft encounter.
- `scripts/simulate-scenarios.ts`
  Add Dr Suruchi and Dr Balkar longitudinal scenarios against the same patient.
- `apps/api/src/encounter-store.ts`
  Expand the store interface beyond `get`/`save` so routes can query patients, history, merge state, and recordings.
- `apps/api/src/supabase-encounter-store.ts`
  Implement the new store methods and map Supabase rows into the enriched contract types.
- `apps/api/src/server.ts`
  Add patient lookup/create, encounter creation, MP4 upload, previous conversation fetch, voice-warning acknowledgement, merge resolution, and longitudinal sign-off routes.
- `apps/api/src/server.test.ts`
  Cover the new end-to-end API contracts, authorization, validation, merge blocking, and warning acknowledgement behavior.
- `apps/api/src/media-processing.ts`
  Normalize live and uploaded recordings into one processing input and reject unsupported or audio-less MP4 uploads.
- `apps/api/src/media-processing.test.ts`
  Verify MIME validation, source-type normalization, and audio-track rejection.
- `apps/api/src/voice-matcher.ts`
  Encapsulate enrollment embedding persistence and cosine-similarity status classification.
- `apps/api/src/voice-matcher.test.ts`
  Verify `match`, `uncertain`, `mismatch`, and `unavailable` decisions.
- `apps/web/src/api.ts`
  Add typed client functions for patient search/create, encounter creation, upload, history fetch, merge resolution, and warning acknowledgement.
- `apps/web/src/App.tsx`
  Replace the demo-only loader with the patient workspace shell and longitudinal review flow.
- `apps/web/src/PatientWorkspace.tsx`
  Hold patient selection, encounter-start actions, voice warning state, and previous-conversation review.
- `apps/web/src/PatientPicker.tsx`
  Render the searchable dropdown, inline add-patient form trigger, and masked mobile display.
- `apps/web/src/AddPatientDialog.tsx`
  Capture name, mobile number, and short voice-enrollment recording.
- `apps/web/src/EncounterHistoryPanel.tsx`
  List prior PACs, recordings, signing doctors, and open the previous conversation review.
- `apps/web/src/MergeReviewPanel.tsx`
  Render IDE-style merge cards with `Use previous`, `Keep current`, and `Edit merged value`.
- `apps/web/src/UploadRecordingForm.tsx`
  Upload MP4 recordings and route them through the same draft-creation flow as live capture.
- `apps/web/src/App.test.tsx`
  Cover patient selection, warning acknowledgement, previous conversation review, merge conflict blocking, and sign-off.
- `apps/web/src/api.test.ts`
  Lock request shapes for the new patient and encounter routes.
- `apps/web/src/styles.css`
  Extend the current visual system for the patient workspace, history rail, merge cards, and upload form without replacing the established brand language.
- `docs/qa/2026-07-26-buildathon-qa.md`
  Append the new internal-browser acceptance run for Dr Suruchi and Dr Balkar.

### Task 1: Extend Shared Longitudinal Contracts

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/workflow.test.ts`

**Interfaces:**
- Consumes: existing `EncounterSchema`, `resolveProposal`, `signEncounter`
- Produces:
  - `VoiceMatchStatusSchema = z.enum(["match", "uncertain", "mismatch", "unavailable"])`
  - `PatientSummarySchema`
  - `RecordingSummarySchema`
  - `MergeConflictSchema`
  - `resolveMergeConflict(encounter: Encounter, command: { fieldId: string; resolution: "use_previous" | "keep_current" | "edited"; value?: string; actorId: string }): Encounter`
  - `signEncounter(encounter: Encounter, command: { actorId: string; actorRole: "clinician" | "coordinator" }): Encounter` updated to reject unresolved merge conflicts and unacknowledged voice warnings

- [ ] **Step 1: Write the failing contract tests**

```ts
it("requires merge conflicts to be resolved before signing", () => {
  const encounter = EncounterSchema.parse({
    id: "enc-2",
    patientReference: "PAT-001",
    patient: {
      id: "patient-1",
      displayName: "Ravi Kumar",
      mobileNumber: "+919900001111"
    },
    procedure: "Elective hernia repair",
    preferredLanguage: "hi-IN",
    state: "clinician_review",
    consentRecorded: true,
    respondentType: "patient",
    sourceType: "uploaded_mp4",
    voiceMatch: {
      status: "mismatch",
      score: 0.41,
      warningAcknowledgedAt: null
    },
    requiredFieldIds: ["medications"],
    proposals: [],
    transcript: [],
    mergeConflicts: [
      {
        fieldId: "medications",
        label: "Current medicines",
        previousValue: "Clopidogrel recorded on July 1, 2024.",
        currentValue: "Blood thinner, exact name unknown.",
        resolution: null,
        required: true
      }
    ],
    audit: []
  });

  expect(() =>
    signEncounter(encounter, {
      actorId: "clinician-1",
      actorRole: "clinician"
    })
  ).toThrow(/merge conflicts/i);
});

it("records an edited merge decision with clinician provenance", () => {
  const updated = resolveMergeConflict(encounterWithConflict, {
    fieldId: "medications",
    resolution: "edited",
    value: "Clopidogrel 75 mg confirmed from strip on camera.",
    actorId: "clinician-1"
  });

  expect(updated.mergeConflicts[0]).toMatchObject({
    resolution: "edited",
    resolvedValue: "Clopidogrel 75 mg confirmed from strip on camera."
  });
  expect(updated.audit.at(-1)).toMatchObject({
    action: "merge.resolved",
    actorId: "clinician-1"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @vaanaya/contracts -- src/workflow.test.ts`
Expected: FAIL with missing `patient`, `voiceMatch`, `mergeConflicts`, or `resolveMergeConflict` support.

- [ ] **Step 3: Write the minimal contract implementation**

```ts
export const VoiceMatchStatusSchema = z.enum([
  "match",
  "uncertain",
  "mismatch",
  "unavailable"
]);

export const MergeConflictSchema = z.object({
  fieldId: z.string().min(1),
  label: z.string().min(1),
  previousValue: z.string(),
  currentValue: z.string(),
  resolution: z.enum(["use_previous", "keep_current", "edited"]).nullable(),
  resolvedValue: z.string().nullable(),
  required: z.boolean()
});

export function resolveMergeConflict(
  encounterInput: Encounter,
  command: {
    fieldId: string;
    resolution: "use_previous" | "keep_current" | "edited";
    value?: string;
    actorId: string;
  }
): Encounter {
  const encounter = EncounterSchema.parse(encounterInput);
  return EncounterSchema.parse({
    ...encounter,
    mergeConflicts: encounter.mergeConflicts.map(conflict =>
      conflict.fieldId === command.fieldId
        ? {
            ...conflict,
            resolution: command.resolution,
            resolvedValue:
              command.resolution === "use_previous"
                ? conflict.previousValue
                : command.resolution === "keep_current"
                  ? conflict.currentValue
                  : command.value?.trim() ?? ""
          }
        : conflict
    )
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @vaanaya/contracts -- src/workflow.test.ts`
Expected: PASS with updated sign-off guard coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/workflow.test.ts
git commit -m "feat: extend longitudinal PAC contracts"
```

### Task 2: Add Supabase Longitudinal Schema and Demo Seed Data

**Files:**
- Create: generated migration file from `supabase migration new longitudinal_pac_mvp` under `supabase/migrations/`
- Modify: `scripts/seed-demo.mjs`
- Test: `apps/api/src/supabase-encounter-store.test.ts`

**Interfaces:**
- Consumes: `EncounterSchema` longitudinal additions from Task 1
- Produces:
  - `patients(display_name, normalized_name, mobile_number, normalized_mobile_number, created_by, organization_id)`
  - `voice_profiles(patient_id, embedding, model_id, model_version, enrollment_recording_id, is_active)`
  - `recordings(encounter_id, storage_path, media_type, duration_seconds, source_type)`
  - `merge_decisions(encounter_id, field_key, decision, resolved_value, resolved_by, resolved_at)`
  - `encounters.previous_encounter_id`, `encounters.respondent_type`, `encounters.source_type`, `encounters.voice_match_status`, `encounters.voice_similarity_score`, `encounters.voice_warning_acknowledged_by`, `encounters.voice_warning_acknowledged_at`
  - Seeded patient `Ravi Kumar / +919900001111` with one signed historical encounter and one current draft encounter

- [ ] **Step 1: Write the failing persistence test**

```ts
it("maps a returning patient encounter with prior history and merge decisions", async () => {
  const store = new SupabaseEncounterStore(mockSupabaseClient);
  const encounter = await store.get("2001");

  expect(encounter?.patient.displayName).toBe("Ravi Kumar");
  expect(encounter?.previousEncounters[0]).toMatchObject({
    id: "1999",
    signedBy: "Dr Suruchi",
    sourceType: "live"
  });
  expect(encounter?.mergeConflicts[0]).toMatchObject({
    fieldId: "medications",
    previousValue: "Clopidogrel 75 mg",
    currentValue: "Blood thinner, exact name unknown."
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @vaanaya/api -- src/supabase-encounter-store.test.ts`
Expected: FAIL because the store does not read patient, history, or merge-decision tables.

- [ ] **Step 3: Write the migration and seed updates**

```sql
alter table public.encounters
  add column previous_encounter_id bigint references public.encounters(id) on delete restrict,
  add column respondent_type text not null default 'patient' check (respondent_type in ('patient')),
  add column source_type text not null default 'live' check (source_type in ('live', 'uploaded_mp4')),
  add column voice_match_status text not null default 'unavailable'
    check (voice_match_status in ('match', 'uncertain', 'mismatch', 'unavailable')),
  add column voice_similarity_score numeric(5, 4),
  add column voice_warning_acknowledged_by uuid references auth.users(id) on delete restrict,
  add column voice_warning_acknowledged_at timestamptz;

create table public.patients (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete restrict,
  display_name text not null,
  normalized_name text not null,
  mobile_number text not null,
  normalized_mobile_number text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, normalized_name, normalized_mobile_number)
);
```

```js
const patient = {
  display_name: "Ravi Kumar",
  normalized_name: "ravi kumar",
  mobile_number: "+919900001111",
  normalized_mobile_number: "919900001111"
};
```

- [ ] **Step 4: Run verification**

Run: `npm run test -w @vaanaya/api -- src/supabase-encounter-store.test.ts`
Expected: PASS after store fixtures are updated for the new schema.

Run: `npm run seed:demo`
Expected: Completes without duplicate-patient errors and creates one returning-patient history chain.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations scripts/seed-demo.mjs apps/api/src/supabase-encounter-store.test.ts
git commit -m "feat: add longitudinal PAC schema and seed data"
```

### Task 3: Expand API Store Abstractions and Longitudinal Routes

**Files:**
- Modify: `apps/api/src/encounter-store.ts`
- Modify: `apps/api/src/supabase-encounter-store.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes:
  - `EncounterStore.get(id: string): Promise<Encounter | null>`
  - Supabase schema from Task 2
- Produces:
  - `searchPatients(input: { organizationId: string; query: string }): Promise<PatientSummary[]>`
  - `createPatient(input: { organizationId: string; actorId: string; displayName: string; mobileNumber: string }): Promise<PatientSummary>`
  - `createEncounter(input: { organizationId: string; actorId: string; patientId: string; procedure: string; preferredLanguage: string; sourceType: "live" | "uploaded_mp4" }): Promise<Encounter>`
  - `listPreviousEncounters(input: { organizationId: string; patientId: string }): Promise<EncounterSummary[]>`
  - `acknowledgeVoiceWarning(input: { encounterId: string; actorId: string }): Promise<Encounter>`
  - HTTP routes:
    - `GET /api/patients?q=`
    - `POST /api/patients`
    - `POST /api/encounters`
    - `GET /api/patients/:id/encounters`
    - `POST /api/encounters/:id/voice-warning/acknowledge`

- [ ] **Step 1: Write the failing API tests**

```ts
it("creates a patient, then starts a live encounter for that patient", async () => {
  const response = await server.inject({
    method: "POST",
    url: "/api/encounters",
    headers: authHeaders,
    payload: {
      patientId: "patient-1",
      procedure: "Elective hernia repair",
      preferredLanguage: "hi-IN",
      sourceType: "live"
    }
  });

  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({
    patient: { id: "patient-1", displayName: "Ravi Kumar" },
    respondentType: "patient",
    sourceType: "live"
  });
});

it("requires voice-warning acknowledgement before signing a mismatch encounter", async () => {
  const response = await server.inject({
    method: "POST",
    url: "/api/encounters/2001/sign",
    headers: authHeaders,
    payload: { actorId: "clinician-1", actorRole: "clinician" }
  });

  expect(response.statusCode).toBe(409);
  expect(response.json().message).toMatch(/acknowledge/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @vaanaya/api -- src/server.test.ts`
Expected: FAIL because the patient routes and acknowledgement route do not exist.

- [ ] **Step 3: Write the minimal store and route implementation**

```ts
export interface EncounterStore {
  get(id: string): Promise<Encounter | null>;
  save(encounter: Encounter): Promise<Encounter>;
  searchPatients(input: {
    organizationId: string;
    query: string;
  }): Promise<PatientSummary[]>;
  createPatient(input: {
    organizationId: string;
    actorId: string;
    displayName: string;
    mobileNumber: string;
  }): Promise<PatientSummary>;
  createEncounter(input: {
    organizationId: string;
    actorId: string;
    patientId: string;
    procedure: string;
    preferredLanguage: string;
    sourceType: "live" | "uploaded_mp4";
  }): Promise<Encounter>;
}
```

```ts
server.get("/api/patients", async request => {
  return store.searchPatients({
    organizationId: request.actor!.organizationId,
    query: String(request.query.q ?? "")
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @vaanaya/api -- src/server.test.ts`
Expected: PASS with patient creation, encounter creation, and acknowledgement coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/encounter-store.ts apps/api/src/supabase-encounter-store.ts apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat: add longitudinal patient and encounter routes"
```

### Task 4: Add Unified Media Ingestion and Voice Matching

**Files:**
- Create: `apps/api/src/media-processing.ts`
- Create: `apps/api/src/media-processing.test.ts`
- Create: `apps/api/src/voice-matcher.ts`
- Create: `apps/api/src/voice-matcher.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes:
  - `SarvamClient.transcribe`
  - encounter creation route from Task 3
- Produces:
  - `normalizeEncounterMedia(input: { bytes: Buffer; filename: string; mimeType: string; sourceType: "live" | "uploaded_mp4" }): Promise<{ audioBytes: Buffer; mediaType: string; sourceType: "live" | "uploaded_mp4" }>`
  - `classifyVoiceMatch(input: { enrollmentEmbedding: number[] | null; sampleEmbedding: number[] | null }): { status: "match" | "uncertain" | "mismatch" | "unavailable"; score: number | null }`
  - `POST /api/encounters/:id/upload`
  - `POST /api/patients/:id/voice-enrollment`

- [ ] **Step 1: Write the failing unit tests**

```ts
it("rejects an mp4 upload without a usable audio track", async () => {
  await expect(
    normalizeEncounterMedia({
      bytes: Buffer.from("fake-video"),
      filename: "silent.mp4",
      mimeType: "video/mp4",
      sourceType: "uploaded_mp4"
    })
  ).rejects.toThrow(/usable audio track/i);
});

it("classifies low similarity as mismatch", () => {
  expect(
    classifyVoiceMatch({
      enrollmentEmbedding: [1, 0, 0],
      sampleEmbedding: [0, 1, 0]
    })
  ).toMatchObject({ status: "mismatch" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @vaanaya/api -- src/media-processing.test.ts src/voice-matcher.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Write the minimal media and voice implementation**

```ts
export async function normalizeEncounterMedia(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  sourceType: "live" | "uploaded_mp4";
}) {
  if (input.sourceType === "uploaded_mp4" && input.mimeType !== "video/mp4") {
    throw new Error("Uploaded PAC recordings must be MP4 files.");
  }

  return {
    audioBytes: input.bytes,
    mediaType: input.mimeType,
    sourceType: input.sourceType
  };
}
```

```ts
export function classifyVoiceMatch(input: {
  enrollmentEmbedding: number[] | null;
  sampleEmbedding: number[] | null;
}) {
  if (!input.enrollmentEmbedding || !input.sampleEmbedding) {
    return { status: "unavailable" as const, score: null };
  }

  const score = cosineSimilarity(input.enrollmentEmbedding, input.sampleEmbedding);
  if (score >= 0.82) return { status: "match" as const, score };
  if (score >= 0.68) return { status: "uncertain" as const, score };
  return { status: "mismatch" as const, score };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @vaanaya/api -- src/media-processing.test.ts src/voice-matcher.test.ts`
Expected: PASS with `match`, `uncertain`, `mismatch`, and `unavailable` coverage plus MP4 rejection.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/media-processing.ts apps/api/src/media-processing.test.ts apps/api/src/voice-matcher.ts apps/api/src/voice-matcher.test.ts apps/api/src/server.ts
git commit -m "feat: add PAC upload and voice match processing"
```

### Task 5: Implement Previous Conversation Review and Merge Persistence

**Files:**
- Modify: `apps/api/src/supabase-encounter-store.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes:
  - `resolveMergeConflict` from Task 1
  - store methods from Task 3
  - media metadata from Task 4
- Produces:
  - `GET /api/encounters/:id/history`
  - `PATCH /api/encounters/:id/merge-conflicts/:fieldId`
  - persisted `merge_decisions` rows linked to previous and current field evidence
  - history payload with recording metadata, transcript turns, translations, timestamps, confidence, and audio seek targets

- [ ] **Step 1: Write the failing API tests**

```ts
it("returns previous conversations with replay metadata and transcript evidence", async () => {
  const response = await server.inject({
    method: "GET",
    url: "/api/encounters/2001/history",
    headers: authHeaders
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().previousEncounters[0]).toMatchObject({
    id: "1999",
    recording: { sourceType: "live", mediaType: "audio/webm" }
  });
  expect(response.json().previousEncounters[0].transcript[0]).toMatchObject({
    speaker: "patient",
    translation: expect.any(String)
  });
});

it("persists an edited merge resolution", async () => {
  const response = await server.inject({
    method: "PATCH",
    url: "/api/encounters/2001/merge-conflicts/medications",
    headers: authHeaders,
    payload: {
      resolution: "edited",
      value: "Clopidogrel 75 mg confirmed from strip and previous PAC."
    }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().mergeConflicts[0]).toMatchObject({
    resolution: "edited"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @vaanaya/api -- src/server.test.ts`
Expected: FAIL because the history and merge-resolution routes are absent.

- [ ] **Step 3: Write the minimal history and merge implementation**

```ts
server.patch<{
  Params: { id: string; fieldId: string };
  Body: { resolution?: "use_previous" | "keep_current" | "edited"; value?: string };
}>("/api/encounters/:id/merge-conflicts/:fieldId", async (request, reply) => {
  const encounter = await store.get(request.params.id);
  if (!encounter) return reply.code(404).send({ message: "Encounter not found." });

  const updated = resolveMergeConflict(encounter, {
    fieldId: request.params.fieldId,
    resolution: request.body.resolution!,
    value: request.body.value,
    actorId: request.actor!.id
  });

  return store.save(updated);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @vaanaya/api -- src/server.test.ts`
Expected: PASS with history playback metadata and merge persistence coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/supabase-encounter-store.ts apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat: add previous conversation review and merge persistence"
```

### Task 6: Build the Patient Workspace, Upload Flow, and History Review UI

**Files:**
- Create: `apps/web/src/PatientWorkspace.tsx`
- Create: `apps/web/src/PatientPicker.tsx`
- Create: `apps/web/src/AddPatientDialog.tsx`
- Create: `apps/web/src/EncounterHistoryPanel.tsx`
- Create: `apps/web/src/UploadRecordingForm.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/api.test.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes:
  - `GET /api/patients`
  - `POST /api/patients`
  - `POST /api/encounters`
  - `GET /api/encounters/:id/history`
- Produces:
  - `searchPatients(query: string): Promise<PatientSummary[]>`
  - `createPatient(input: { displayName: string; mobileNumber: string; enrollmentAudio: Blob }): Promise<PatientSummary>`
  - `createEncounterRequest(input: { patientId: string; procedure: string; preferredLanguage: string; sourceType: "live" | "uploaded_mp4" }): Promise<Encounter>`
  - `getEncounterHistory(encounterId: string): Promise<{ previousEncounters: EncounterSummary[] }>`

- [ ] **Step 1: Write the failing browser-level tests**

```tsx
it("lets the clinician select a returning patient and open previous conversations", async () => {
  vi.stubGlobal("fetch", vi.fn(async input => {
    if (String(input).includes("/api/patients?q=ravi")) {
      return new Response(JSON.stringify([
        { id: "patient-1", displayName: "Ravi Kumar", mobileLast4: "1111" }
      ]));
    }
    if (String(input).includes("/api/encounters/2001/history")) {
      return new Response(JSON.stringify({
        previousEncounters: [{ id: "1999", signedBy: "Dr Suruchi", transcript: [] }]
      }));
    }
    return new Response(JSON.stringify(currentEncounter));
  }) as typeof fetch);

  render(<App />);
  await user.type(await screen.findByLabelText(/find patient/i), "ravi");
  await user.click(await screen.findByRole("button", { name: /ravi kumar/i }));
  await user.click(await screen.findByRole("button", { name: /previous conversation/i }));

  expect(await screen.findByText(/Dr Suruchi/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @vaanaya/web -- src/App.test.tsx src/api.test.ts`
Expected: FAIL because the workspace still loads only the demo encounter.

- [ ] **Step 3: Write the minimal workspace implementation**

```tsx
export function PatientWorkspace() {
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [encounter, setEncounter] = useState<Encounter | null>(null);

  return (
    <section className="patient-workspace">
      <PatientPicker onSelect={setSelectedPatient} />
      <UploadRecordingForm
        patient={selectedPatient}
        onEncounterCreated={setEncounter}
      />
      <EncounterHistoryPanel encounter={encounter} />
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @vaanaya/web -- src/App.test.tsx src/api.test.ts`
Expected: PASS with patient search, history open, and upload request-shape coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/api.test.ts apps/web/src/PatientWorkspace.tsx apps/web/src/PatientPicker.tsx apps/web/src/AddPatientDialog.tsx apps/web/src/EncounterHistoryPanel.tsx apps/web/src/UploadRecordingForm.tsx apps/web/src/styles.css
git commit -m "feat: add longitudinal patient workspace UI"
```

### Task 7: Build Merge Review, Warning Acknowledgement, and Scenario Verification

**Files:**
- Create: `apps/web/src/MergeReviewPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `scripts/simulate-scenarios.ts`
- Modify: `docs/qa/2026-07-26-buildathon-qa.md`

**Interfaces:**
- Consumes:
  - `PATCH /api/encounters/:id/merge-conflicts/:fieldId`
  - `POST /api/encounters/:id/voice-warning/acknowledge`
  - `POST /api/encounters/:id/sign`
- Produces:
  - IDE-style conflict cards with `Use previous`, `Keep current`, `Edit merged value`
  - voice-warning banner that requires acknowledgement but does not block PAC review access
  - updated simulation output for Dr Suruchi success and Dr Balkar blocked sign-off
  - QA notes proving historical PAC immutability after the second encounter

- [ ] **Step 1: Write the failing UI and scenario tests**

```tsx
it("disables sign-off until the clinician resolves every merge conflict", async () => {
  render(<App />);

  expect(await screen.findByText("Current medicines")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /sign pac note/i })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: /use previous/i }));
  expect(screen.getByRole("button", { name: /sign pac note/i })).toBeEnabled();
});
```

```ts
it("keeps Dr Balkar blocked when uncertainty remains unresolved", async () => {
  const summary = await runScenario("dr-balkar-longitudinal");
  expect(summary.signed).toBe(false);
  expect(summary.blockers).toContain("unresolved_merge_conflicts");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @vaanaya/web -- src/App.test.tsx`
Expected: FAIL because merge cards and warning acknowledgement UI do not exist.

Run: `npm run simulate:scenarios`
Expected: FAIL or missing longitudinal scenario coverage.

- [ ] **Step 3: Write the minimal merge-review and scenario implementation**

```tsx
export function MergeReviewPanel({
  conflicts,
  onResolve
}: {
  conflicts: MergeConflict[];
  onResolve: (fieldId: string, resolution: "use_previous" | "keep_current" | "edited", value?: string) => void;
}) {
  return conflicts.map(conflict => (
    <article key={conflict.fieldId} className="merge-card">
      <h3>{conflict.label}</h3>
      <button onClick={() => onResolve(conflict.fieldId, "use_previous")}>Use previous</button>
      <button onClick={() => onResolve(conflict.fieldId, "keep_current")}>Keep current</button>
    </article>
  ));
}
```

```ts
await runScenario("dr-suruchi-longitudinal");
await runScenario("dr-balkar-longitudinal");
```

- [ ] **Step 4: Run verification**

Run: `npm run test -w @vaanaya/web -- src/App.test.tsx`
Expected: PASS with merge conflict blocking and warning acknowledgement coverage.

Run: `npm run simulate:scenarios`
Expected: PASS with Dr Suruchi signing successfully and Dr Balkar remaining blocked.

Run: `npm run typecheck && npm run build`
Expected: PASS across contracts, API, and web.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/MergeReviewPanel.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx scripts/simulate-scenarios.ts docs/qa/2026-07-26-buildathon-qa.md
git commit -m "feat: add longitudinal merge review and scenario verification"
```

## Self-Review

### Spec coverage

- Doctor login, patient dropdown, add-patient flow, live PAC start, and recorded PAC upload are covered by Tasks 3 and 6.
- Returning-patient lookup by normalized name plus mobile number is covered by Tasks 2 and 3.
- Real voice-biometric enrollment and advisory matching are covered by Tasks 2 and 4.
- Previous conversations with playback, transcript, translation, timestamps, and evidence links are covered by Tasks 5 and 6.
- IDE-style selective merge against the latest signed PAC is covered by Tasks 1, 5, and 7.
- Immutable signed PAC history and carry-forward semantics are covered by Tasks 1, 2, 5, and 7.
- Dr Suruchi and Dr Balkar simulations are covered by Task 7.
- Patient-only respondent selection for the encounter is enforced in Tasks 1, 2, and 3.
- No spec gaps remain.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Each task includes concrete files, interfaces, test examples, commands, and commit commands.
- The Supabase migration filename is intentionally generated via `supabase migration new longitudinal_pac_mvp` because this repository uses imperative migrations and the CLI controls the timestamped filename.

### Type consistency

- `voiceMatch.status` uses the same `match | uncertain | mismatch | unavailable` set in Tasks 1 through 7.
- `sourceType` stays `live | uploaded_mp4` in contracts, API routes, persistence, and UI calls.
- Merge resolution options stay `use_previous | keep_current | edited` in contracts, API payloads, persistence, and UI actions.
- The authoritative patient identity contract stays `displayName + mobileNumber` with normalized lookup in all persistence and route tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-vaanaya-longitudinal-pac-mvp.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
