# Evidence Recording and Patient Audio Design

## Goal

Make the PAC evidence workflow usable during a live clinician encounter:

- give generated patient audio an obvious play/replay trigger;
- replace the fixed recording duration with real encounter recording metadata;
- let the clinician append additional recorded interactions from the evidence rail;
- show the number of recordings attached to the encounter; and
- highlight complete PAC-relevant evidence phrases selected by OpenAI.

This is a lean MVP design for the vanilla demo flow. It does not add recording
editing, deletion, waveform visualization, background uploads, or edge-case
recovery.

## Clinician Experience

### Patient summary audio

After Sarvam generates the patient-language summary, the drawer shows:

- the translated summary;
- an explicit **Play patient audio** button;
- the native audio control as a visible fallback; and
- **Replay patient audio** after playback has started.

Changing the selected language clears the old generated audio so the doctor
cannot accidentally play audio in the previously selected language.

### Evidence rail recording

The current fixed `01:16` badge is removed. The evidence rail header shows:

- total recorded duration derived from attached recordings; and
- a human-readable count such as `1 recording` or `3 recordings`.

The initial uploaded MP4 counts as one recording. Each successfully transcribed
microphone capture counts as one additional recording. A failed or cancelled
capture does not increment the count.

The mic action is prominent and uses these states:

1. **Record additional interaction**
2. **Stop & add to PAC**
3. **Transcribing with Sarvam…**
4. Return to **Record additional interaction**

Each successful capture appends new source-linked transcript evidence and PAC
suggestions. It never silently overwrites earlier evidence.

## Evidence Phrase Highlighting

The existing OpenAI PAC-structuring response adds `evidencePhrases` to each
structured conversation turn. Each phrase must be copied exactly from that
segment's translated text. OpenAI is instructed to select short, clinically
relevant phrases covering:

- medicines and timing;
- allergies and explicit negatives;
- symptoms and medical history;
- prior anesthesia or procedure experience;
- fasting statements;
- uncertainty and missing recall;
- functional capacity; and
- other directly stated PAC evidence.

The server rejects phrases that are not literal substrings of the corresponding
translated segment. This prevents invented highlights. Phrase matching is
case-insensitive, and invalid phrases are discarded without discarding the
underlying transcript.

The web client highlights valid phrases in the translated transcript using
semantic `<mark>` elements. Original-language text remains unmodified unless an
OpenAI phrase is also a literal substring of it. Highlighting is explanatory
only and does not change checklist status or clinician authority.

## Data Model

`TranscriptTurn` gains an optional `evidencePhrases: string[]` field so existing
encounters remain compatible.

`Encounter` gains an optional `recordings` collection. Each item contains:

- a stable recording ID;
- source type (`uploaded_mp4` or `microphone`);
- non-negative duration in seconds; and
- creation timestamp.

Existing demo encounters are seeded with one uploaded recording using the known
synthetic duration. New microphone duration is measured in the browser and sent
with the audio upload. The server persists the authoritative recording entry
only after successful transcription.

When older encounter data has no `recordings` collection, the UI derives a
safe fallback from existing upload audit evidence instead of showing a made-up
duration.

## API and Processing Flow

The existing encounter speech endpoint accepts the audio plus
`durationSeconds`. On success it:

1. transcribes through Sarvam;
2. creates the existing Sarvam-backed PAC suggestions;
3. asks OpenAI for grounded evidence phrases for the new transcript;
4. validates OpenAI evidence phrases against the transcript text;
5. appends transcript turns and suggestions;
6. appends one microphone recording metadata item; and
7. returns the updated encounter.

The complete uploaded-recording path stores one uploaded recording metadata
item and uses the same OpenAI evidence-phrase validation.

The complete recording includes phrases in its existing OpenAI structuring
response, so it adds no API call. Live speech uses one focused OpenAI
highlighting request because its current suggestion extraction runs through
Sarvam rather than the OpenAI structuring flow.

## Failure Behavior

- Patient audio generation failure keeps the generate action available and
  shows the existing error notice.
- Browser audio playback rejection leaves the native audio control available
  and shows a concise playback error.
- Microphone denial or unsupported recording leaves the encounter unchanged.
- Sarvam/OpenAI failure leaves the new recording uncounted and earlier evidence
  intact.
- Missing OpenAI phrases results in an unhighlighted transcript, not a failed
  PAC.

## Testing

Focused automated coverage will verify:

- explicit patient-audio play/replay behavior;
- duration and recording-count rendering;
- successful additional recording increments metadata and appends evidence;
- failed recording does not increment the count;
- OpenAI phrases are accepted only when grounded in their segment;
- translated transcript uses semantic highlights; and
- existing encounters without new optional fields continue to parse.

The final vanilla-flow check will run the existing uploaded recording, generate
patient audio, play it, add one microphone interaction using a mocked browser
media stream, and verify updated count plus highlighted evidence.
