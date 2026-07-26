# Synthetic PAC Recording Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the provisioned demo clinician process the complete synthetic PAC MP4 into a diarized, translated, PAC-aware evidence conversation.

**Architecture:** The API submits the bundled recording to Sarvam Batch STT with diarization and translation, polls until results are available, and passes only diarized text to OpenAI. OpenAI returns a schema-constrained clinician-review conversation, which the API converts to source-linked Evidence Rail turns.

**Tech Stack:** Fastify, TypeScript, Sarvam Batch STT (`saaras:v3`), OpenAI Responses API Structured Outputs, Supabase Auth, React, Vitest.

## Global Constraints

- The recording is a synthetic buildathon conversation and must be labeled as such in UI and audit data.
- Provider keys stay server-side; no audio or secret is exposed through browser code.
- OpenAI may organize evidence only; it must not diagnose, grade ASA, identify an unknown medicine, provide medication instructions, or approve a plan.
- Sarvam source segment identifiers and timestamps must survive to the rendered conversation.
- If role mapping is uncertain, retain the anonymous Sarvam label and use `unknown`.

---

## File Structure

- `apps/api/src/sarvam-client.ts`: Sarvam Batch job submission, upload, polling, and diarized translation parsing.
- `apps/api/src/openai-client.ts`: PAC-aware structured conversation extraction from diarized text.
- `apps/api/src/server.ts`: authenticated synthetic recording route and persisted evidence/audit updates.
- `apps/api/src/server.test.ts`: route-level happy-path evidence test with provider fakes.
- `apps/api/src/openai-client.test.ts`: schema and PAC-boundary client tests.
- `apps/api/package.json`: server-side OpenAI SDK dependency.
- `scripts/seed-demo.mjs`: Suruchi demo user creation/update and membership.
- `apps/web/src/api.ts`: typed process request client.
- `apps/web/src/App.tsx`: pipeline status and rendered conversation.
- `apps/web/src/App.test.tsx`: upload-state and source-linked conversation rendering test.

### Task 1: Provision the synthetic demo clinician

**Files:**
- Modify: `scripts/seed-demo.mjs`

**Interfaces:**
- Consumes: `SURUCHI_DEMO_EMAIL`, `SURUCHI_DEMO_PASSWORD`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`.
- Produces: a confirmed Supabase user with clinician membership in `Vaanaya Buildathon Demo`.

- [ ] **Step 1: Add a failing auth smoke command expectation**

Add the explicit Suruchi environment defaults to the seed script so a local run creates or updates the same user every time:

```js
const clinicianEmail = process.env.SURUCHI_DEMO_EMAIL ?? "suruchi.patel@artemis.com";
const clinicianPassword = process.env.SURUCHI_DEMO_PASSWORD;
if (!clinicianPassword) throw new Error("SURUCHI_DEMO_PASSWORD is required.");
```

- [ ] **Step 2: Run the seed script before the change**

Run: `SURUCHI_DEMO_EMAIL=suruchi.patel@artemis.com SURUCHI_DEMO_PASSWORD='password@123' node --env-file=.env scripts/seed-demo.mjs`

Expected: the existing script does not explicitly guarantee the Suruchi account.

- [ ] **Step 3: Implement the explicit Suruchi provision path**

Replace the optional random password behavior with the required environment password and preserve the existing `createUser`/`updateUserById` plus organization-membership upsert.

- [ ] **Step 4: Verify provisioned credentials**

Run the seed command from Step 2, then sign in through `supabase.auth.signInWithPassword({ email: clinicianEmail, password: clinicianPassword })` using a short server-side smoke command that prints only `login ok` or `login failed`.

Expected: `login ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demo.mjs
git commit -m "feat: provision Suruchi demo clinician"
```

### Task 2: Add Sarvam Batch diarized translation

**Files:**
- Modify: `apps/api/src/sarvam-client.ts`
- Test: `apps/api/src/sarvam-client.test.ts`

**Interfaces:**
- Produces:

```ts
export type DiarizedSegment = {
  id: string;
  speakerLabel: string;
  originalText: string;
  translatedText: string;
  startSeconds: number;
  endSeconds: number;
};

processDiarizedTranslation(input: TranscriptionInput): Promise<{
  requestId: string | null;
  segments: DiarizedSegment[];
}>;
```

- [ ] **Step 1: Write a failing Sarvam batch parsing test**

Mock the batch create/upload/start/status/download sequence and assert that a response with two diarized segments returns the exact IDs, speaker labels, original text, translated text, and timestamps.

```ts
expect(result.segments).toEqual([
  expect.objectContaining({ id: "seg-1", speakerLabel: "Speaker 1", startSeconds: 0 }),
  expect.objectContaining({ id: "seg-2", speakerLabel: "Speaker 2", endSeconds: 4.2 })
]);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -w @vaanaya/api -- -t 'diarized translation'`

Expected: FAIL because `processDiarizedTranslation` does not exist.

- [ ] **Step 3: Implement the bounded batch workflow**

Create the job with `model: "saaras:v3"`, `mode: "translate"`,
`language_code: "hi-IN"`, and `with_diarization: true`; upload the MP4,
start it, poll a finite number of times, download the result, and map returned
diarized rows to `DiarizedSegment`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -w @vaanaya/api -- -t 'diarized translation'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sarvam-client.ts apps/api/src/sarvam-client.test.ts
git commit -m "feat: add Sarvam batch diarized translation"
```

### Task 3: Add the PAC-aware OpenAI conversation client

**Files:**
- Create: `apps/api/src/openai-client.ts`
- Create: `apps/api/src/openai-client.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `DiarizedSegment[]` from Task 2 and `OPENAI_API_KEY`.
- Produces:

```ts
export type PacConversationTurn = {
  segmentId: string;
  speakerRole: "clinician" | "patient" | "unknown";
  topic: "medications" | "allergies" | "prior_anesthesia" | "fasting" | "history" | "administrative" | "other";
  uncertainty: boolean;
};

class OpenAiPacClient {
  structurePacConversation(segments: DiarizedSegment[]): Promise<PacConversationTurn[]>;
}
```

- [ ] **Step 1: Write a failing structured-output test**

Mock `responses.parse`, provide two Sarvam segments, and assert that the
returned turns preserve `segmentId`, use only the declared role/topic enums,
and do not fabricate transcript text.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -w @vaanaya/api -- -t 'PAC-aware conversation'`

Expected: FAIL because the client is absent.

- [ ] **Step 3: Implement `OpenAiPacClient`**

Install the official server-side `openai` package. Use `gpt-5.6-sol` with
Responses Structured Outputs and a Zod schema. The system prompt must state
that input is a synthetic PAC conversation, roles can be `unknown`, and the
model must organize supplied evidence only without clinical inference.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -w @vaanaya/api -- -t 'PAC-aware conversation'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/src/openai-client.ts apps/api/src/openai-client.test.ts pnpm-lock.yaml
git commit -m "feat: structure synthetic PAC conversations with OpenAI"
```

### Task 4: Process and persist the complete synthetic recording

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: `SarvamClient.processDiarizedTranslation` and
  `OpenAiPacClient.structurePacConversation`.
- Produces: `POST /api/encounters/:id/complete-example-recording` returning
  `{ encounter, status: "completed" }`.

- [ ] **Step 1: Write a failing route test**

Inject faked Sarvam and OpenAI clients. POST the authenticated demo encounter
route and assert that the saved encounter contains original/translated
transcript turns with Sarvam segment IDs/timestamps, OpenAI role labels, and an
audit event with `syntheticDemo: true`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -w @vaanaya/api -- -t 'complete synthetic recording'`

Expected: FAIL with 404.

- [ ] **Step 3: Implement the authenticated route**

Read `Examples/WhatsApp Audio 2026-07-26 at 09.14.01.mp4`, call Sarvam, call
OpenAI with diarized text only, convert results to Evidence Rail transcript
turns, save the encounter, and record `recording.synthetic_processed` with
provider request IDs. Return a 502 with a truthful provider-stage message on
processing failure.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -w @vaanaya/api -- -t 'complete synthetic recording'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat: process complete synthetic PAC recording"
```

### Task 5: Render pipeline status and conversation evidence

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `POST /api/encounters/:id/complete-example-recording`.
- Produces: one upload control and source-linked rendered conversation cards.

- [ ] **Step 1: Write a failing UI test**

Mock the route response. Click `Upload complete synthetic recording`, assert
the disabled status copy `Diarizing and translating with Sarvam…`, resolve the
request, and assert that the page shows `Synthetic demo recording — clinician
review required`, a speaker role, timestamp, original text, translation, and
topic.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -w @vaanaya/web -- -t 'complete synthetic recording'`

Expected: FAIL because the control and status do not exist.

- [ ] **Step 3: Implement the smallest UI path**

Add `processCompleteExampleRecording(encounterId)` to the API client. Replace
the current example button copy and lifecycle with the three pipeline states.
Render each returned transcript turn as an Evidence Rail card and label the
section as synthetic demo evidence.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -w @vaanaya/web -- -t 'complete synthetic recording'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/App.test.tsx
git commit -m "feat: show synthetic PAC conversation evidence"
```

### Task 6: Verify the deployed happy path

**Files:**
- Modify: `docs/qa/2026-07-26-buildathon-qa.md`

**Interfaces:**
- Consumes: completed Tasks 1-5 and the existing Railway deployment.
- Produces: documented proof of the synthetic end-to-end demo.

- [ ] **Step 1: Run focused checks**

Run:

```bash
npm run test -w @vaanaya/api -- -t 'diarized translation|PAC-aware conversation|complete synthetic recording'
npm run test -w @vaanaya/web -- -t 'complete synthetic recording'
npm run typecheck -w @vaanaya/api
npm run typecheck -w @vaanaya/web
```

Expected: all selected tests and both type checks pass.

- [ ] **Step 2: Exercise the real synthetic MP4 pipeline**

Use the production browser to sign in as Suruchi after deploying the configured
environment variables. Trigger the complete synthetic upload and verify at
least one Sarvam timestamped segment and one OpenAI PAC topic card.

- [ ] **Step 3: Record the result**

Add a QA row containing the date, synthetic recording filename, successful
Sarvam diarization/translation result, successful OpenAI structuring result,
and rendered Evidence Rail result. Do not include credentials or provider
secrets.

- [ ] **Step 4: Commit**

```bash
git add docs/qa/2026-07-26-buildathon-qa.md
git commit -m "docs: verify synthetic recording demo"
```
