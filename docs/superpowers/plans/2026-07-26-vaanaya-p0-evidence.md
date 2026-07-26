# Vaanaya P0 Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver authenticated PAC workflows, source-linked live extraction, clinician golden-case review, and measured timing evidence.

**Architecture:** Supabase Auth establishes identity, Fastify owns authorization and clinical boundary checks, and Postgres stores review/timing evidence. React exposes three focused surfaces: PAC workspace, clinical review, and timing evidence.

**Tech Stack:** React 19, Fastify 5, TypeScript 5.8, Supabase JS 2.110, PostgreSQL/RLS, Sarvam Saaras v3 and sarvam-30b structured output, Vitest.

## Global Constraints

- Do not diagnose, grade ASA status, select anesthesia, infer medicine identity, give autonomous instructions, or sign autonomously.
- Every model proposal must retain transcript source IDs.
- Never expose `SUPABASE_SECRET_KEY` or `SARVAM_API_KEY` to the browser.
- Use authenticated database membership for authorization, never `user_metadata`.
- All review and timing evidence is explicitly human-entered.

---

### Task 1: Authenticated API boundary

**Files:**
- Create: `apps/api/src/auth.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/auth.ts`
- Modify: `apps/web/src/api.ts`
- Test: `apps/api/src/server.test.ts`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**
- Produces: `AuthenticatedActor { id, email, organizationId, role }`
- Produces: browser `getAccessToken()` and authorization-aware API requests.

- [ ] Write API tests proving missing tokens return 401, non-members return 403, and validated actor IDs are used for writes.
- [ ] Run the focused tests and verify the new assertions fail for missing authorization.
- [ ] Add Supabase token validation and organization membership lookup behind an injectable authenticator.
- [ ] Add the browser Supabase client, sign-in session handling, and bearer headers.
- [ ] Run API and web tests until the authenticated boundary passes.

### Task 2: Clinical review persistence

**Files:**
- Create: `supabase/migrations/*_clinical_evidence.sql`
- Create: `apps/api/src/golden-cases.ts`
- Create: `apps/api/src/review-store.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/server.test.ts`

**Interfaces:**
- Produces: `GET /api/reviews/golden-cases`
- Produces: `PUT /api/reviews/golden-cases/:caseId`
- Produces: `GoldenCaseReview { verdict, notes, confidence, reviewedAt, reviewerId }`

- [ ] Write failing API tests for the 15-case queue, clinician-only verdict writes, validation, and resumable progress.
- [ ] Run the focused tests and verify the review endpoints are absent.
- [ ] Generate an imperative Supabase migration with the CLI, add RLS and organization-scoped policies.
- [ ] Implement a JSONL golden-case reader and memory/Supabase review store.
- [ ] Implement the authorized review endpoints and pass the focused tests.

### Task 3: Mobile clinical sign-off page

**Files:**
- Create: `apps/web/src/ReviewPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: the golden-case review endpoints.
- Produces: `/review` phone-friendly review workflow with an evidence stitch and saved progress.

- [ ] Write a failing browser test that opens `/review`, records a verdict and notes, and advances to the next case.
- [ ] Run it and verify the missing review page causes the failure.
- [ ] Implement the page with visible provenance, safety boundaries, three verdict controls, progress, and save receipt.
- [ ] Verify keyboard/mobile accessibility and pass web tests.

### Task 4: Timing evidence

**Files:**
- Create: `apps/api/src/timing-store.ts`
- Create: `apps/web/src/EvidencePage.tsx`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/api/src/server.test.ts`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Produces: paired `TimingObservation` records and derived median/delta summary.
- Produces: `/evidence` entry and summary page.

- [ ] Write failing tests proving empty evidence makes no reduction claim and paired observations generate the correct median delta.
- [ ] Run focused tests and verify they fail because timing support is absent.
- [ ] Implement storage, authorization, validation, and pure statistics.
- [ ] Implement the three-scenario entry page and evidence-only summary.
- [ ] Pass focused tests.

### Task 5: Source-linked live extraction

**Files:**
- Modify: `apps/api/src/sarvam-client.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/src/SpeechCapture.tsx`
- Modify: `apps/web/src/api.ts`
- Test: `apps/api/src/sarvam-client.test.ts`
- Test: `apps/api/src/server.test.ts`

**Interfaces:**
- Produces: `POST /api/encounters/:id/speech` returning updated transcript and guarded proposals.

- [ ] Write failing tests for strict structured output and the ambiguous blood-thinner safety case.
- [ ] Run them and verify failure because extraction does not exist.
- [ ] Implement sarvam-30b JSON Schema extraction and deterministic server validation.
- [ ] Connect encounter-scoped capture and refresh the PAC workspace.
- [ ] Pass focused and scenario tests.

### Task 6: Database, production, and evidence QA

**Files:**
- Modify: `.env.example`
- Modify: `scripts/seed-demo.mjs`
- Modify: `docs/qa/2026-07-26-buildathon-qa.md`
- Modify: `BUILD_CHECKLIST.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: deployed reviewer URL, demo clinician setup, and reproducible QA evidence.

- [ ] Apply the migration and seed/update a password-authenticated synthetic clinician without logging its password.
- [ ] Run RLS/advisor checks and authenticated production smoke tests.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, scenario simulation, and audit.
- [ ] Deploy to Railway and verify `/`, `/review`, `/evidence`, login, review persistence, and P0 authorization.
- [ ] Record confirmed results and remaining human-only actions in QA.
