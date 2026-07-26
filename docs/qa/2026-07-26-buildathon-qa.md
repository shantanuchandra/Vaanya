# Vaanaya Buildathon QA Handoff

Last verified: 26 July 2026, Asia/Kolkata

## Executive status

Vaanaya is publicly deployed and the flagship synthetic PAC flow works end to
end:

1. Source-linked Hindi/Hinglish evidence is displayed.
2. The colloquial blood-thinner statement remains uncertain.
3. Signing is blocked until a clinician records a resolution.
4. Source links remain attached after the edit.
5. The clinician can sign the note.
6. A Kannada handoff is generated from approved generic content.
7. Sarvam Bulbul v3 returns playable patient-language audio.
8. The PAC view can be printed or saved as an A4 PDF.
9. Supabase email/password authentication protects every clinical and
   cost-bearing API route.
10. `/review` captures anesthesiologist verdicts for all 15 golden cases.
11. `/evidence` captures paired paper-versus-Vaanaya observations without
    fabricating a time-savings claim.
12. Encounter-scoped speech creates source-linked, review-only PAC suggestions.

Production URL:
[https://vaanaya-production.up.railway.app](https://vaanaya-production.up.railway.app)

Clinician review:
[https://vaanaya-production.up.railway.app/review](https://vaanaya-production.up.railway.app/review)

Timing evidence:
[https://vaanaya-production.up.railway.app/evidence](https://vaanaya-production.up.railway.app/evidence)

Railway project: `Vaanaya`

Supabase database migration: `20260726055059_initial_vaanaya_schema.sql`

## Verification summary

| Area | Result | Evidence |
|---|---:|---|
| Automated application and corpus tests | Pass | 61 tests passed |
| TypeScript typecheck | Pass | All workspaces |
| Production build | Pass | React and API built successfully |
| Dependency audit | Pass | Zero known vulnerabilities |
| Supabase migration | Pass | Local and remote histories match |
| Supabase database lint | Pass | Zero schema errors |
| Supabase RLS boundary | Pass | Anonymous table query denied |
| Production health check | Pass | HTTP 200, Sarvam and Supabase configured |
| Production React application | Pass | HTTP 200, zero browser-console errors on initial load |
| Production security headers | Pass | CSP, `nosniff`, and `SAMEORIGIN` present |
| Supabase clinician password login | Pass | Valid clinician membership resolved; anonymous API receives 401 |
| Golden-case review persistence | Pass | 15-case queue and RLS-protected verdict storage implemented |
| Timing evidence persistence | Pass | Paired observations only; empty state makes no reduction claim |
| Live Hindi speech-to-text | Pass | Production Saaras v3 transcription returned expected Hindi |
| Live structured extraction | Pass | `sarvam-30b` returned source-linked `uncertain` medication output |
| Live Kannada translation | Pass | Production Kannada text generated |
| Live Kannada TTS | Pass | Production MP3 generated and rendered in browser |
| Clinician sign gate | Pass | Unresolved required fields block signing |
| Source provenance | Pass | Exact transcript turn remains linked after resolution |
| A4 print/PDF action | Pass | Automated UI test and print stylesheet |
| Telegram bot credentials | Pass | Bot `getMe` authenticated |
| Telegram patient delivery | Blocked | No patient/demo chat ID configured |

## Three-scenario simulation

Run with:

```bash
npm run simulate:scenarios
```

All three D4 cases passed:

| Case | Language path | Expected gate | Result |
|---|---|---|---|
| Colloquial blood-thinner description | Hindi/Hinglish | Block until clinician resolution | Pass |
| Fasting correction including milk tea | Kannada/Kanglish | Allow after explicit patient correction | Pass |
| Caregiver recalls prior anesthesia problem | English | Block until clinician resolution | Pass |

For every scenario:

- the final state was `signed`;
- transcript source links were preserved;
- the workflow applied the correct sign gate;
- no aspirin, clopidogrel, or warfarin name was inferred;
- a clinician audit event was appended.

## Production integrations

### Sarvam

Implemented against the current official API documentation:

- `/speech-to-text` with `saaras:v3` and `codemix`;
- `/translate` with `sarvam-translate:v1`;
- `/text-to-speech` with `bulbul:v3`;
- `/v1/chat/completions` with `sarvam-30b`, strict JSON Schema output,
  `reasoning_effort=low`, and a bounded 4,096-token extraction budget;
- Kannada output uses `kn-IN`;
- all credentials remain server-side.

The production STT test transcribed:

> वो खून पतला करने वाली गोली लेता हूं नाम याद नहीं कल भी ली थी।

### Supabase

Production schema contains:

- organizations and role-bearing memberships;
- encounters and consent events;
- source-language transcript segments;
- PAC field proposals and source links;
- clinician edits;
- immutable signed note versions;
- patient summary versions;
- append-only audit events.
- organization-scoped golden-case reviews;
- organization-scoped timing observations.

The synthetic proof record contains:

- 2 consent events;
- 6 transcript segments;
- 4 PAC proposals;
- 4 proposal-to-source links;
- an append-only audit trail.

`USE_SUPABASE_STORE=false` is intentionally set in Railway. This keeps repeated
demo rehearsals resettable in memory. Setting it to `true` switches the API to
the seeded Supabase record and makes the final signed note permanent.

### Telegram

The server adapter is implemented using `sendAudio`:

- Kannada MP3 and caption are sent as one message;
- `protect_content=true` is enabled;
- upstream errors do not expose chat details;
- unsigned encounters receive HTTP 409.

Live delivery has not been attempted because the bot has no updates and
`TELEGRAM_DEMO_CHAT_ID` is not configured. Sending to an inferred recipient
would be unsafe.

## Known limitations and pending human evidence

### P0 engineering — complete

1. Authenticated clinician login and server-validated organization membership.
2. Protected clinical, mutation, Sarvam, export, and handoff routes.
3. Source-linked live speech extraction with deterministic ambiguity guard.
4. Deployed clinician review and timing-evidence capture surfaces.

### P0 human evidence — ready to collect

1. **Golden-case verdicts are not complete until the anesthesiologist submits
   them at `/review`.** Do not claim completed clinical validation before the
   page shows 15/15.
2. **Time savings are not established until paired observations are entered at
   `/evidence`.** The product correctly shows no measured claim while empty.

### P1 — required for the intended full MVP

1. Sarvam uses short-audio REST capture rather than streaming WebSocket STT.
2. Telegram delivery needs an explicit demo chat ID.
3. The final Supabase-backed immutable sign flow should be performed only once,
   after rehearsal is complete.
4. Patient summary content is deliberately generic. Medication and fasting
   instructions are never generated automatically.
5. No hospital SSO, FHIR/HL7 export, or live hospital-system integration exists.
6. No real multi-user concurrency or encounter assignment has been exercised.

### P2 — polish

1. Add an explicit scenario selector for judges instead of using the simulator.
2. Add a recorded fallback demo.
3. Add analytics for elapsed PAC documentation time.
4. Add downloadable PDF generation on the server; current output uses browser
   Print / Save as PDF.
5. Add a visible build/version identifier to the UI.

## Human actions on return

Perform these in order:

1. **Rehearse before enabling persistence.**
   Keep Railway `USE_SUPABASE_STORE=false`.

2. **Review the 15 golden cases with the anesthesiologist.**
   Open `/review` on her phone. For each case, mark `clinically appropriate`,
   `needs revision`, or `unsafe`, record correction notes, and save. Completion
   is shown only when 15/15 verdicts are persisted.

3. **Measure the primary impact claim.**
   Open `/evidence`. Time the same three scenarios on paper and in Vaanaya,
   then record paired durations and corrections. Do not invent results.

4. **Enable Telegram safely.**
   Send `/start` to the bot from the intended demo account, retrieve that
   account's chat ID, set Railway `TELEGRAM_DEMO_CHAT_ID`, and perform one
   synthetic delivery.

5. **Run the live three-minute sequence.**
   Use the blood-thinner case, resolve without naming a medicine, sign, generate
   Kannada, play audio, and show Print / PDF.

6. **Only for the final persistence demonstration:**
   set `USE_SUPABASE_STORE=true`, reload, resolve, and sign once. The resulting
   signed note is intentionally immutable.

7. **Record a fallback video** after the final rehearsal.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run simulate:scenarios
npm run seed:demo
```

Local development:

```bash
npm run dev:api
npm run dev:web
```

Production smoke check:

```bash
curl -fsS https://vaanaya-production.up.railway.app/health
```

## Product boundary

Vaanaya is clinician-supervised documentation software. It does not diagnose,
assign ASA class, determine anesthetic fitness, select an anesthetic plan,
identify an unknown medication, or issue medication/fasting instructions.
Every final note requires clinician review and sign-off.
