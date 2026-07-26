# Evidence Recording and Patient Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit patient-audio playback, real recording count/duration, repeatable microphone capture, and OpenAI-grounded evidence phrase highlighting to the PAC review workspace.

**Architecture:** Store optional recording metadata and evidence phrases on the shared encounter contract. Extend the existing OpenAI PAC response for uploaded recordings and use one focused OpenAI phrase request for live captures, validating every phrase as a literal transcript substring on the server. Render metadata and semantic highlights in small focused React components while keeping `App` responsible for orchestration.

**Tech Stack:** TypeScript, Zod, Fastify, OpenAI Responses API, React, Vitest, Testing Library, MediaRecorder.

## Global Constraints

- Optimize only the vanilla MVP/demo flow; do not add recording deletion, editing, waveforms, background uploads, or edge-case recovery.
- The initial uploaded MP4 counts as one recording; only successfully transcribed microphone captures increment the count.
- Highlight full PAC evidence phrases, including timing, uncertainty, negatives, and functional capacity.
- OpenAI phrases must be literal, case-insensitive substrings of the associated transcript text; invalid phrases are discarded.
- Highlighting never changes checklist state or clinician authority.
- Changing patient-summary language clears previously generated audio.
- Preserve existing encounters by making all new contract fields optional/defaulted.

---

### Task 1: Recording Metadata and Evidence Phrase Contracts

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/workflow.test.ts`
- Modify: `apps/api/src/demo-encounter.ts`

**Interfaces:**
- Produces: `RecordingMetadataSchema`, `RecordingMetadata`, `TranscriptTurn.evidencePhrases?: string[]`, and `Encounter.recordings: RecordingMetadata[]`.
- `RecordingMetadata` shape: `{ id: string; sourceType: "uploaded_mp4" | "microphone"; durationSeconds: number; recordedAt: string }`.

- [ ] **Step 1: Write the failing contract test**

Add a workflow test that parses a hand-written encounter containing:

```ts
recordings: [{
  id: "recording-1",
  sourceType: "uploaded_mp4",
  durationSeconds: 76,
  recordedAt: "2026-07-26T09:14:01.000Z"
}],
transcript: [{
  id: "turn-1",
  speaker: "patient",
  language: "en-IN",
  original: "I took the blood thinner yesterday.",
  translation: "I took the blood thinner yesterday.",
  evidencePhrases: ["blood thinner", "yesterday"],
  confidence: 0.95,
  offsetSeconds: 4
}]
```

Assert the parsed encounter retains both phrases and the recording metadata. Add a second assertion that an encounter without `recordings` parses with `recordings: []`.

- [ ] **Step 2: Run the contract test to verify RED**

Run:

```bash
npm run test -w @vaanaya/contracts -- src/workflow.test.ts --reporter=dot
```

Expected: FAIL because `recordings` is stripped/undefined and `evidencePhrases` is not retained.

- [ ] **Step 3: Implement the minimal schemas**

In `packages/contracts/src/index.ts`:

```ts
export const RecordingMetadataSchema = z.object({
  id: z.string().min(1),
  sourceType: z.enum(["uploaded_mp4", "microphone"]),
  durationSeconds: z.number().nonnegative(),
  recordedAt: z.string().datetime()
});

export type RecordingMetadata = z.infer<typeof RecordingMetadataSchema>;
```

Add `evidencePhrases: z.array(z.string().min(1)).optional()` to
`TranscriptTurnSchema` and `recordings: z.array(RecordingMetadataSchema).default([])`
to `EncounterSchema`.

Seed `createDemoEncounter()` with one 76-second uploaded recording so the primary
demo immediately shows `1 recording · 1:16`.

- [ ] **Step 4: Run the contract test to verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/workflow.test.ts apps/api/src/demo-encounter.ts
git commit -m "feat: track encounter recording metadata"
```

---

### Task 2: OpenAI-Grounded Evidence Phrases

**Files:**
- Modify: `apps/api/src/openai-client.ts`
- Modify: `apps/api/src/openai-client.test.ts`

**Interfaces:**
- Produces: `PacConversationTurn.evidencePhrases: string[]`.
- Produces: `OpenAiPacClient.highlightEvidencePhrases(text: string): Promise<string[]>`.
- Internal helper: `groundEvidencePhrases(text: string, phrases: string[]): string[]`.

- [ ] **Step 1: Write failing OpenAI client tests**

Update the structured conversation fixture so a turn returns:

```ts
evidencePhrases: ["blood thinner", "forgot the name", "invented diagnosis"]
```

Assert only the two literal phrases survive for the matching translated segment.
Add a focused live-text test:

```ts
const phrases = await client.highlightEvidencePhrases(
  "I can climb one flight of stairs but become breathless."
);
expect(phrases).toEqual([
  "climb one flight of stairs",
  "become breathless"
]);
```

The fake OpenAI response must also include `"not present in transcript"` and the
test must prove it is discarded.

- [ ] **Step 2: Run the OpenAI tests to verify RED**

```bash
npm run test -w @vaanaya/api -- src/openai-client.test.ts --reporter=dot
```

Expected: FAIL because turn evidence phrases and `highlightEvidencePhrases` do
not exist.

- [ ] **Step 3: Implement phrase schemas and grounding**

Add `evidencePhrases: z.array(z.string().min(1)).max(12)` to
`PacConversationTurnSchema`. Add:

```ts
const EvidencePhraseResponseSchema = z.object({
  evidencePhrases: z.array(z.string().min(1)).max(12)
});

export function groundEvidencePhrases(
  text: string,
  phrases: string[]
): string[] {
  const normalized = text.toLocaleLowerCase();
  return [...new Set(
    phrases
      .map(phrase => phrase.trim())
      .filter(Boolean)
      .filter(phrase => normalized.includes(phrase.toLocaleLowerCase()))
  )];
}
```

In `structurePacConversation`, ground each turn's phrases against the matching
segment's `translatedText`. Update the system prompt to request short literal
PAC evidence phrases covering medicines, timing, allergies/negatives, symptoms,
history, anesthesia, fasting, uncertainty, and functional capacity.

Implement `highlightEvidencePhrases(text)` with `gpt-5.6-sol`,
`EvidencePhraseResponseSchema`, the same system constraints, and
`groundEvidencePhrases` before returning.

- [ ] **Step 4: Run the OpenAI tests to verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the OpenAI slice**

```bash
git add apps/api/src/openai-client.ts apps/api/src/openai-client.test.ts
git commit -m "feat: extract grounded PAC evidence phrases"
```

---

### Task 3: Persist Uploaded and Microphone Recordings

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

**Interfaces:**
- Consumes: `PacConversationTurn.evidencePhrases`, `RecordingMetadata`.
- Changes: `transcribeEncounterSpeech(encounterId, audio, languageCode, durationSeconds)`.
- The speech request sends `durationSeconds` as a URL query parameter.

- [ ] **Step 1: Write failing server tests**

For complete synthetic recording processing, return OpenAI turns with grounded
phrases and assert:

```ts
expect(response.json().encounter.recordings).toEqual([
  expect.objectContaining({
    sourceType: "uploaded_mp4",
    durationSeconds: expect.any(Number)
  })
]);
expect(response.json().encounter.transcript).toContainEqual(
  expect.objectContaining({
    evidencePhrases: ["blood thinner", "name is not remembered"]
  })
);
```

For `/api/encounters/demo/speech?languageCode=hi-IN&durationSeconds=12.4`, provide
an `openAiPacClient.highlightEvidencePhrases` fake and assert the returned
encounter has one additional `{ sourceType: "microphone", durationSeconds: 12.4 }`
entry plus the phrases on the appended turn.

Add a failing-transcription test asserting the recording count does not change.

- [ ] **Step 2: Run focused API tests to verify RED**

```bash
npm run test -w @vaanaya/api -- src/server.test.ts --reporter=dot
```

Expected: FAIL because the server neither stores recordings nor phrases.

- [ ] **Step 3: Implement server persistence**

Extend `BuildServerOptions.openAiPacClient` with:

```ts
highlightEvidencePhrases(text: string): Promise<string[]>;
```

Pass `openAiPacClient` and parsed `durationSeconds` into
`extractSpeechIntoEncounter`. After Sarvam transcription succeeds, call
`highlightEvidencePhrases`, attach the returned phrases to the new transcript
turn, and append one microphone `RecordingMetadata`.

In `encounterFromDiarizedRecording`, copy each structured turn's
`evidencePhrases` into its `TranscriptTurn`. Append exactly one uploaded
recording whose duration is:

```ts
Math.max(0, ...input.segments.map(segment => segment.endSeconds))
```

Replace the encounter's previous `uploaded_mp4` metadata entry rather than
duplicating it when the demo upload endpoint is intentionally re-run. Preserve
all `microphone` entries.

- [ ] **Step 4: Write and run the failing web API test**

Call:

```ts
await transcribeEncounterSpeech("demo", audio, "hi-IN", 12.4);
```

Assert the request URL contains `durationSeconds=12.4`. Run:

```bash
npm run test -w @vaanaya/web -- src/api.test.ts --reporter=dot
```

Expected before implementation: FAIL because the function accepts only three
arguments and omits duration.

- [ ] **Step 5: Update the web API helper**

Change the signature to:

```ts
export async function transcribeEncounterSpeech(
  encounterId: string,
  audio: Blob,
  languageCode: "unknown" | "hi-IN" | "kn-IN" | "en-IN" = "unknown",
  durationSeconds = 0
)
```

Append `durationSeconds=${encodeURIComponent(durationSeconds)}` to the request
URL. Parse the encounter through `EncounterSchema` as before.

- [ ] **Step 6: Run API and web API tests to verify GREEN**

Run both commands from Steps 2 and 4. Expected: PASS.

- [ ] **Step 7: Commit the persistence slice**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat: persist uploaded and live PAC recordings"
```

---

### Task 4: Evidence Highlights and Recording Controls

**Files:**
- Create: `apps/web/src/EvidenceText.tsx`
- Create: `apps/web/src/EvidenceText.test.tsx`
- Modify: `apps/web/src/SpeechCapture.tsx`
- Create: `apps/web/src/SpeechCapture.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `EvidenceText({ text, phrases, lang })`.
- Changes: `SpeechCapture` measures the successful capture duration and passes it
  to `transcribeEncounterSpeech`.
- Consumes: `Encounter.recordings`.

- [ ] **Step 1: Write the failing semantic-highlight test**

Render:

```tsx
<EvidenceText
  text="I take a blood thinner but forgot the name."
  phrases={["blood thinner", "forgot the name"]}
  lang="en-IN"
/>
```

Assert `screen.getAllByRole("mark")` is not used because `<mark>` has no stable
implicit role; instead assert:

```ts
expect(container.querySelectorAll("mark")).toHaveLength(2);
expect(container.querySelector("mark")?.textContent).toBe("blood thinner");
```

Also test case-insensitive matching and non-overlapping output.

- [ ] **Step 2: Run the highlight test to verify RED**

```bash
npm run test -w @vaanaya/web -- src/EvidenceText.test.tsx --reporter=dot
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `EvidenceText`**

Create a pure component that locates case-insensitive literal phrase ranges,
sorts ranges by start position then longest phrase, removes overlaps, and emits
plain text plus `<mark className="evidence-keyword">` nodes. If phrases are empty
or unmatched, return a normal `<p lang={lang}>`.

Update `EvidenceTurn` in `App.tsx` to render `EvidenceText` for original and
translated content. Pass phrases to original text too; unmatched phrases simply
remain unmarked.

- [ ] **Step 4: Write failing microphone and header tests**

In `SpeechCapture.test.tsx`, stub `getUserMedia`, `MediaRecorder`, and time.
Start at `10_000ms`, stop at `22_400ms`, emit an audio blob, and assert
`transcribeEncounterSpeech` receives `12.4`.

In `App.test.tsx`, add:

```ts
recordings: [
  { id: "r1", sourceType: "uploaded_mp4", durationSeconds: 76, recordedAt: "2026-07-26T09:14:01.000Z" },
  { id: "r2", sourceType: "microphone", durationSeconds: 12.4, recordedAt: "2026-07-26T09:20:00.000Z" }
]
```

Assert the Evidence Rail shows `2 recordings` and `1:28`, does not show a
hard-coded `01:16`, and exposes `Record additional interaction`. Add a legacy
fixture with no recording metadata but an audit action of
`recording.synthetic_processed`; assert it shows `1 recording` with no invented
duration.

- [ ] **Step 5: Run the new web tests to verify RED**

```bash
npm run test -w @vaanaya/web -- src/SpeechCapture.test.tsx src/App.test.tsx --reporter=dot
```

Expected: FAIL on the old copy, missing duration argument, and fixed duration.

- [ ] **Step 6: Implement recording UX and derived metadata**

In `SpeechCapture`, store `startedAtMs` in a ref, compute elapsed seconds when
stopping, and call:

```ts
transcribeEncounterSpeech(encounterId, audio, "hi-IN", durationSeconds)
```

Use the exact button states:

- `Record additional interaction`
- `Stop & add to PAC`
- `Transcribing with Sarvam…`

In `App`, derive:

```ts
const hasLegacyUploadedRecording = encounter.audit.some(
  event => event.action === "recording.synthetic_processed"
);
const recordingCount =
  encounter.recordings.length ||
  (hasLegacyUploadedRecording ? 1 : 0);
const totalDurationSeconds = encounter.recordings.reduce(
  (total, recording) => total + recording.durationSeconds,
  0
);
```

Render pluralized recording count and `m:ss`. When recordings are absent, show
`1 recording` without duration if an existing
`recording.synthetic_processed` audit event proves a legacy upload exists;
otherwise show `No recordings`. Never infer duration from transcript offsets.
Move the mic capture directly under the Evidence Rail heading and style it as
the primary evidence action.

- [ ] **Step 7: Run all Task 4 tests to verify GREEN**

```bash
npm run test -w @vaanaya/web -- src/EvidenceText.test.tsx src/SpeechCapture.test.tsx src/App.test.tsx --reporter=dot
```

Expected: PASS.

- [ ] **Step 8: Commit the evidence UI slice**

```bash
git add apps/web/src/EvidenceText.tsx apps/web/src/EvidenceText.test.tsx apps/web/src/SpeechCapture.tsx apps/web/src/SpeechCapture.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat: add repeatable evidence recording controls"
```

---

### Task 5: Explicit Patient Audio Play and Replay

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Adds an `HTMLAudioElement` ref for the generated patient summary audio.
- Adds visible `Play patient audio` and `Replay patient audio` actions.

- [ ] **Step 1: Write the failing playback test**

Generate a Hindi patient summary through the existing mocked handoff response.
Stub `HTMLMediaElement.prototype.play` to resolve, click `Play patient audio`,
and assert `play` was called. Dispatch a `play` event and assert the button copy
becomes `Replay patient audio`.

Add a rejected-play test that stubs `play()` to reject and asserts the status
message `Patient audio could not be played. Use the audio controls below.`

- [ ] **Step 2: Run the playback tests to verify RED**

```bash
npm run test -w @vaanaya/web -- src/App.test.tsx --reporter=dot
```

Expected: FAIL because only the native audio control exists.

- [ ] **Step 3: Implement explicit playback**

Add `patientAudioRef` and `patientAudioStarted` state. After handoff generation,
render:

```tsx
<button type="button" onClick={playPatientSummaryAudio}>
  <Volume2 size={16} />
  {patientAudioStarted ? "Replay patient audio" : "Play patient audio"}
</button>
<audio
  ref={patientAudioRef}
  controls
  onPlay={() => setPatientAudioStarted(true)}
  ...
/>
```

`playPatientSummaryAudio` calls `await patientAudioRef.current?.play()` and uses
the exact fallback notice from Step 1 on rejection. Reset
`patientAudioStarted` when language changes or new audio is generated.

- [ ] **Step 4: Run the playback tests to verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the playback slice**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat: add patient audio play control"
```

---

### Task 6: Full Vanilla-Flow Verification

**Files:**
- Modify only if a verification failure reveals a defect in files already named
  above.

**Interfaces:**
- Consumes all prior task outputs.

- [ ] **Step 1: Run the complete automated suite**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0. The Vite large-chunk warning is non-blocking.

- [ ] **Step 2: Run the live browser vanilla path**

With the web and API dev processes running and the clinician signed in:

1. Open the primary Sulochana Patel encounter.
2. Verify `1 recording · 1:16`.
3. Process the synthetic MP4 and verify evidence phrases are highlighted.
4. Generate Hindi patient audio and click **Play patient audio**.
5. Start and stop **Record additional interaction** once.
6. Verify the transcript appends rather than replaces evidence.
7. Verify the recording count increments and total duration increases.

If real microphone permission is unavailable in the in-app browser, report that
specific limitation and rely on the tested MediaRecorder flow; do not substitute
an unrelated browser.

- [ ] **Step 3: Review the final diff**

```bash
git status --short
git diff --stat
git diff --check
```

Confirm no unrelated user-owned changes were staged or overwritten.
