# Vaanaya P0 Evidence Design

## Goal

Close the four buildathon-critical gaps without crossing Vaanaya's product boundary: authenticate clinicians, turn live speech into source-linked draft suggestions, capture anesthesiologist review of golden cases, and record real paper-versus-Vaanaya timing evidence.

## Product boundary

- Vaanaya is clinician-supervised documentation support.
- It does not diagnose, grade ASA status, recommend an anesthetic, infer a medicine identity, issue medication/fasting instructions, or sign autonomously.
- Live extraction creates reviewable proposals only. `uncertain` and `missing` remain blocking.
- Every extracted proposal cites one or more transcript turns.
- Only authenticated organization members may access clinical or cost-bearing routes.
- Reviewer and timing evidence must be entered by a human; the app must not manufacture validation or impact claims.

## Authentication

The browser signs in with Supabase email/password using a publishable key. It attaches the access token to API requests. The API validates the token with Supabase `getUser(jwt)`, then checks `organization_members`. The validated user ID and database role become the actor identity; client-provided actor IDs are ignored.

`/health`, static assets, and the sign-in surface remain public. Encounter reads and writes, speech, extraction, handoff, review, and timing routes require authentication. Reviewer writes require a `clinician`; timing writes allow `clinician` or `coordinator`.

## Live speech extraction

An encounter-scoped audio route performs Saaras v3 transcription, appends a patient transcript turn, and invokes `sarvam-30b` with strict JSON Schema output. Accepted fields are limited to medications, allergies, prior anesthesia, fasting, and open items. The server rejects outputs without source turn IDs, converts unsafe or incomplete medication identities to `uncertain`, and never promotes model output to `clinician_entered`.

The UI shows new suggestions beside their exact evidence and requires a clinician action before they can influence a signed note.

## Clinical review portal

`/review` is a mobile-first sign-off workspace for the anesthesiologist. It presents the 15 golden cases one at a time with:

- patient conversation and confidence;
- expected PAC output and source links;
- required clarification and prohibited inference boundaries;
- verdict: `approved`, `needs_revision`, or `unsafe`;
- structured correction notes and reviewer confidence.

Progress is saved after every verdict. The page shows a review receipt with reviewer identity and timestamp. An aggregate summary is evidence, not a claim of clinical efficacy.

Visual direction: a quiet clinical ledger using Vaanaya's green/ink system. The signature element is an “evidence stitch”: a vertical thread visually connecting the utterance, expected field, and verdict. This is intentionally specific to provenance review rather than a generic analytics dashboard.

## Timing evidence

`/evidence` captures paired paper and Vaanaya durations for the three synthetic scenarios, correction counts, and notes. It reports medians and percentage delta only when the user has entered paired observations. Empty state explicitly says no measured claim is available.

## Storage

Add `golden_case_reviews` and `timing_observations` with RLS. Rows belong to an organization and authenticated reviewer. The API uses the server client after authorization; RLS remains enabled as defense in depth.

## Success criteria

- Unauthenticated protected requests return 401.
- A valid non-member returns 403.
- Signed actions use the validated clinician identity.
- Ambiguous “blood thinner” speech remains uncertain with no invented drug or instruction.
- A clinician can review all 15 golden cases from a phone and resume later.
- Timing calculations are derived only from saved paired observations.
- Existing 1,000-case corpus, API, contract, and browser tests remain green.
