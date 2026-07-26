# Synthetic PAC Recording Pipeline

## Goal

Let the provisioned demo clinician upload the complete synthetic PAC MP4 and
view a source-linked, translated conversation. The system must make clear that
this is a mock buildathon conversation and that every output requires clinician
review.

## Scope

1. Provision `suruchi.patel@artemis.com` as a clinician in the existing demo
   organization using the supplied password.
2. Replace the recording-demo trigger with a complete synthetic MP4 upload
   flow.
3. Process the recording with Sarvam Batch Speech-to-Text using `saaras:v3`,
   English translation mode, timestamps, and speaker diarization.
4. Send the diarized translated result, not the raw audio, to OpenAI.
5. Use OpenAI Structured Outputs to create a PAC-aware conversation view with
   source segment identifiers.
6. Render the processed conversation on the existing evidence page.

## Architecture

```text
Suruchi login
  -> server-side encounter creation
  -> server-side synthetic MP4 upload
  -> Sarvam batch job (translate + diarize)
  -> polling and result download
  -> OpenAI structured PAC conversation extraction
  -> stored encounter transcript/proposals/audit
  -> source-linked Evidence Rail
```

The API owns all provider credentials. The browser receives only status and
the completed review artifact.

## Processing contract

Sarvam speaker labels remain anonymous until the OpenAI step. The OpenAI
request contains the PAC context and diarized segments. Its JSON schema returns
each conversation turn with:

- `segmentId`, `startSeconds`, and `endSeconds` from Sarvam;
- `speakerLabel` and a role classification (`clinician`, `patient`, or
  `unknown`);
- original and English-translated utterances;
- one of the PAC documentation topics; and
- an explicit uncertainty indicator.

OpenAI is not permitted to diagnose, assign ASA class, identify a medication
from a vague description, provide medication instructions, or approve an
anaesthetic plan. Its output remains a clinician-review draft.

## UI

The main recording action shows this sequence:

1. `Uploading synthetic recording…`
2. `Diarizing and translating with Sarvam…`
3. `Structuring PAC conversation…`
4. Completed Evidence Rail with speaker, timestamp, English translation,
   original transcript, topic, and source reference.

The page labels the material `Synthetic demo recording — clinician review
required`.

## Failure behavior

- Authentication failure: remain on login and show the provider error.
- Sarvam batch failure: retain the encounter and show a retryable processing
  error without fabricating a transcript.
- OpenAI refusal or invalid output: show diarized Sarvam content and mark PAC
  interpretation unavailable; do not create unsupported proposals.
- No speaker certainty: retain Sarvam's anonymous speaker label and classify
  the role as `unknown`.

## Verification

- Provisioned Suruchi login succeeds in the deployed browser.
- The complete example MP4 creates a Sarvam batch job and returns diarized,
  translated segments.
- OpenAI response conforms to the declared schema and preserves segment IDs.
- The Evidence Rail renders at least one original/translation/source-linked
  conversation card from the real synthetic recording.

## Privacy and demo boundary

The recording is explicitly synthetic. It is labeled as such in the browser,
the server audit event, and the rendered evidence. The product remains a
clinician-supervised documentation assistant, not a diagnostic or treatment
system.
