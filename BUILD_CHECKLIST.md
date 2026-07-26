# Vaanaya Build Checklist

This order follows the system's critical feedback loop: define safe inputs and boundaries, produce structured cases, reject unsafe or invalid outputs, measure blind spots, obtain clinician feedback, and feed revisions back into templates.

## 1. Foundations

- [x] Lock MVP boundary: clinician-supervised PAC documentation only.
- [x] Lock primary language path: English/Hinglish clinician and Hindi/Hinglish patient.
- [x] Lock secondary path: Kannada/Kanglish patient handoff.
- [x] Create local environment-key placeholders.
- [x] Approve the clinical test-corpus design.
- [x] Write the corpus implementation plan.

## 2. Clinical knowledge boundary

- [x] Write the evidence-backed PAC Source of Truth.
- [x] Separate published evidence, clinician observations, and synthetic assumptions.
- [x] Define the paper-PAC field model.
- [x] Define prohibited autonomous decisions.
- [x] Define the three-case clinician time comparison.

## 3. Executable corpus contract

- [x] Write failing contract tests.
- [x] Implement case-level validation.
- [x] Write failing corpus-invariant tests.
- [x] Implement corpus-level validation.
- [x] Publish the JSON Schema.

## 4. Synthetic-case production

- [x] Author scenario templates across all 15 risk families.
- [x] Write failing generator tests.
- [x] Implement deterministic generation.
- [x] Generate exactly 1,000 cases.
- [x] Verify the 700/150/150 language distribution.
- [x] Verify at least 60% D3–D5 cases.

## 5. Quality-control loop

- [x] Build the JSONL validator CLI.
- [x] Reject malformed, unsafe, uncited, or inconsistent cases.
- [x] Generate a coverage report.
- [x] Detect missing scenario families and weak distributions.
- [x] Feed coverage failures back into templates and regenerate.

## 6. Clinician feedback loop

- [x] Select a 15-case golden set.
- [x] Include the colloquial blood-thinner ambiguity case.
- [x] Create the anesthesiologist review checklist.
- [x] Deploy the authenticated 15-case clinical review capture page.
- [ ] Record reviews as approved, needs revision, or unsafe.
- [ ] Feed review findings back into templates and expectations.

## 7. Product integration

- [ ] Connect Sarvam streaming STT.
- [x] Connect and live-verify Sarvam Saaras v3 REST speech ingress.
- [x] Convert encounter-scoped speech into strict source-linked Sarvam-30B suggestions.
- [x] Add speaker role and source-language capture to the vertical demo.
- [x] Add translation and confidence display.
- [x] Map transcript turns to PAC fields.
- [x] Implement missing/uncertain/intentionally-skipped states.
- [x] Require clinician edit and sign-off.
- [ ] Generate approved patient instructions.
- [x] Add signed-state-gated Kannada translation and patient-language playback.
- [x] Implement protected Telegram audio delivery behind signed-state gating.
- [ ] Configure a consented Telegram demo chat and live-verify delivery.
- [x] Create the Supabase encounter, correction, approval, and audit schema.
- [x] Apply and lint the production Supabase migration.
- [x] Seed and verify the source-linked synthetic database record.
- [x] Implement and live-test the feature-gated Supabase encounter store.
- [x] Protect API routes with validated Supabase clinician membership.
- [x] Persist golden-case reviews and paired timing observations with RLS.
- [ ] Switch authenticated encounter traffic from demo memory to Supabase.

## 8. Buildathon proof

- [x] Run the core blood-thinner case end to end in a real browser.
- [x] Add a browser-printable A4 PAC artifact with PDF-save support.
- [x] Simulate two additional distinct end-to-end cases.
- [ ] Time the same cases on paper and with Vaanaya.
- [x] Deploy the paired paper-versus-Vaanaya timing capture page.
- [ ] Record a fallback demo.
- [ ] Rehearse two consecutive three-minute demos.
- [x] Verify hosted production behavior.
- [ ] End the demo on the signed, source-linked PAC artifact.
