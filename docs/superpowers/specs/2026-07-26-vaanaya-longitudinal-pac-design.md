# Vaanaya Longitudinal PAC MVP Design

## Objective

Extend Vaanaya so an authenticated doctor can create or select a patient,
conduct a live PAC or upload an MP4 recording, review previous PACs and their
conversations, and create a new signed PAC that selectively merges previous and
current evidence.

This is a synthetic-data MVP. Voice matching assists the doctor but does not
establish identity or block access.

## MVP Scope

The MVP includes:

- clinician login;
- a searchable patient dropdown with an inline add-patient action;
- returning-patient lookup using normalized mobile number and name;
- real speaker-embedding enrollment and similarity comparison;
- one respondent selected for the entire encounter;
- patient-only respondents for the current demo;
- live PAC capture and uploaded MP4 audio ingestion;
- longitudinal, immutable signed PAC versions;
- replayable prior recordings with synchronized transcripts and translations;
- field-level comparison and selective carry-forward from the latest signed PAC;
- Dr Suruchi and Dr Balkar simulation scenarios.

Patient kin, anti-spoofing, voice identity enforcement, and production-grade
biometric governance are outside this MVP.

## Users and Simulation Roles

### Doctor

An authenticated clinician can select patients, start encounters, inspect
historical evidence, resolve merge conflicts, and sign PAC versions.

### Dr Suruchi simulation

Dr Suruchi performs a careful PAC. She rephrases medical terminology, follows
up on unknowns, reviews historical evidence, resolves each conflict, and signs
only after required uncertainties are resolved.

### Dr Balkar simulation

Dr Balkar performs a poor PAC. He asks incomplete questions, attempts premature
assumptions, and skips historical evidence. The product must preserve visible
uncertainty and prevent sign-off while required fields or merge conflicts remain
unresolved.

### Patient simulation

The synthetic patient answers accurately and completely in plain language but
does not understand medical terminology. The doctor must use patient-friendly
wording. The respondent is selected once per encounter and is always `patient`
for this MVP.

## Data Model

### patients

- `id`
- `organization_id`
- `display_name`
- `normalized_name`
- `mobile_number`
- `normalized_mobile_number`
- `created_at`
- `created_by`

Within an organization, the normalized mobile number and normalized name form
the authoritative returning-patient lookup key.

### voice_profiles

- `id`
- `patient_id`
- `embedding`
- `model_id`
- `model_version`
- `enrollment_recording_id`
- `created_at`

The MVP stores one active profile per patient. A new enrollment replaces the
active comparison profile without altering historical encounter recordings.

### recordings

- `id`
- `encounter_id`
- `storage_path`
- `media_type`
- `duration_seconds`
- `source_type`: `live` or `uploaded_mp4`
- `created_at`

The original recording remains attached to its encounter and can be replayed
by an authorized doctor.

### pac_encounters

- `id`
- `patient_id`
- `organization_id`
- `doctor_id`
- `procedure`
- `respondent_type`: `patient`
- `source_type`: `live` or `uploaded_mp4`
- `status`: `draft` or `signed`
- `previous_encounter_id`
- `voice_match_status`: `match`, `uncertain`, `mismatch`, or `unavailable`
- `voice_similarity_score`
- `voice_warning_acknowledged_by`
- `voice_warning_acknowledged_at`
- `created_at`
- `signed_at`

Existing transcript turns, field proposals, evidence links, and clinician edits
remain linked to the encounter. A signed PAC is immutable. A returning visit
creates a new encounter linked to the latest signed PAC; it never overwrites the
older record.

### merge_decisions

- `id`
- `encounter_id`
- `field_key`
- `previous_proposal_id`
- `current_proposal_id`
- `decision`: `use_previous`, `keep_current`, or `edited`
- `resolved_value`
- `resolved_by`
- `resolved_at`

This record preserves the old value, new value, selected value, reviewing
doctor, and links to both sets of evidence.

## Doctor Workflow

1. The doctor signs in and lands on the patient workspace.
2. A searchable dropdown shows patients by display name and masked mobile
   number.
3. `Add new patient` appears inside the dropdown and collects name, mobile
   number, and a short voice-enrollment recording.
4. Selecting an existing patient shows prior PAC dates, procedures, signing
   doctors, and the latest voice comparison status.
5. The doctor starts a live PAC or uploads an MP4 file containing audio.
6. The system transcribes the conversation, labels speakers, translates where
   required, proposes PAC fields, and creates a speaker embedding.
7. For returning patients, the embedding is compared with the enrolled profile.
   A failed or uncertain comparison warns the doctor. Name plus mobile number
   remain authoritative, and the doctor may acknowledge the warning and
   continue.
8. The current draft is compared field-by-field with the latest signed PAC.
9. Changed, missing, or uncertain fields become conflict cards.
10. The doctor resolves every conflict and required uncertainty.
11. The doctor signs a new immutable PAC version.

## Field-Level Merge Experience

The merge interface follows an IDE conflict-card pattern. Each conflict card
shows:

- the field name and comparison status;
- the previous signed value, PAC date, and signing doctor;
- the current proposed value;
- `Use previous`;
- `Keep current`;
- `Edit merged value`;
- `View previous evidence`;
- `View current evidence`.

Unchanged fields appear as carried forward and remain individually reviewable.
They do not require a merge decision. Sign-off is disabled until all required
uncertainty and every conflict is resolved.

No merge choice changes the previous PAC. The new signed version stores the
doctor's decision and full provenance.

## Previous Conversation Review

Every historical PAC exposes a `Previous conversation` view containing:

- full recording playback;
- speaker-labelled transcript turns;
- original language and translation;
- timestamps;
- transcription confidence;
- links from PAC fields to the relevant audio and transcript segments.

Selecting a field-level evidence link seeks the audio player to the earliest
linked segment and highlights all supporting turns. The doctor can also play
the complete recording.

## Audio and Voice Processing

Live recordings and uploaded MP4 recordings enter the same server-side
pipeline:

1. validate media type and size;
2. retain the original encounter recording;
3. decode audio to the voice model's required mono PCM format;
4. transcribe and translate;
5. extract PAC suggestions with evidence links;
6. create a fixed-length speaker embedding;
7. compare the embedding with the active enrollment using cosine similarity.

Thresholds produce `match`, `uncertain`, or `mismatch`. The UI always exposes
the advisory result and never describes it as confirmed identity. If voice
processing is unavailable, the encounter continues with status `unavailable`.

MP4 validation rejects files with no usable audio track. The MVP does not
process video frames.

## Error Handling

- Invalid patient details remain in the form with a clear correction message.
- Duplicate name-and-mobile matches direct the doctor to the existing patient.
- Unsupported, oversized, corrupt, or audio-less MP4 files are rejected before
  encounter processing.
- Failed decoding, transcription, translation, or speaker comparison remains
  visible and retryable.
- A voice mismatch or uncertain result requires doctor acknowledgement but
  does not prevent PAC access.
- Unknown clinical facts remain unknown. The system does not infer medicines,
  diagnoses, risk classification, or instructions.
- Required unresolved fields and unresolved merge conflicts block sign-off.
- Signed PAC versions and their source evidence cannot be edited.

## Security Boundary for the MVP

Existing clinician authentication and organization scoping apply to patients,
recordings, transcripts, and PACs. Biometric consent workflows, encryption-key
architecture, retention policies, liveness detection, and anti-spoofing are
deferred. The product must visibly label voice matching as MVP identity
assistance rather than authentication.

## Testing

### Automated tests

- patient normalization and name-plus-mobile matching;
- duplicate-patient prevention within an organization;
- cross-organization access rejection;
- voice-profile enrollment and embedding persistence;
- match, uncertain, mismatch, and unavailable voice results;
- warning acknowledgement without access blocking;
- MP4 acceptance and corrupt/audio-less MP4 rejection;
- live and uploaded recordings entering the same processing contract;
- previous recordings and transcript metadata retrieval;
- immutable signed PAC history;
- latest-signed-PAC selection;
- merge conflict creation for changed, missing, and uncertain fields;
- all three merge decisions and their provenance;
- carried-forward unchanged fields;
- sign-off blocking for required uncertainty and unresolved conflicts;
- evidence-to-audio timestamp links.

### Internal-browser acceptance test

Run two simulations against the same returning synthetic patient:

1. Dr Suruchi finds the patient by name and mobile, receives a voice match,
   reviews a previous conversation, uploads or records the new PAC, resolves
   merge conflicts carefully, and signs the new version.
2. Dr Balkar opens the same patient, receives a warning or incomplete capture,
   skips evidence review, and attempts to sign. The interface must retain
   uncertainty and block sign-off until the required review is complete.

The final test also verifies that the first signed PAC and its recording remain
unchanged and replayable after the second PAC is created.

## Success Criteria

- A doctor can log in, add or select a patient, and start a PAC.
- The same patient is retrievable years later using name and mobile number.
- A real speaker embedding produces an advisory comparison against enrollment.
- Live capture and MP4 audio upload both create reviewable PAC drafts.
- Previous conversations are visible, replayable, and linked to PAC evidence.
- A new doctor can selectively merge previous and current PAC fields.
- Signed PAC versions remain immutable and auditable.
- The careful-doctor path succeeds and the poor-doctor path exposes or blocks
  unsafe incompleteness.
