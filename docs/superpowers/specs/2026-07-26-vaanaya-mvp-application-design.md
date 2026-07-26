# Vaanaya MVP Application Design

**Status:** Approved  
**Date:** 2026-07-26

## Goal

Build a production-like demo that turns a multilingual PAC conversation into a source-linked draft, surfaces uncertainty, requires clinician review, signs an immutable note version, and produces an approved patient handoff.

## System boundary

- React/Vite owns the clinician and patient-facing browser experience.
- Fastify owns Sarvam secrets, live audio orchestration, extraction adapters, workflow commands, Telegram, and PDF generation.
- Supabase Postgres is authoritative for identities, encounters, transcript segments, PAC proposals, citations, edits, signed versions, summaries, and audit events.
- Supabase Auth identifies clinicians and coordinators.
- Supabase Storage holds approved artifacts and optional synthetic demo uploads.
- Supabase Realtime may synchronize review state but does not carry audio.
- LangGraph is excluded from the core MVP. Long-running follow-up may adopt its Functional API after the signed-PAC loop is stable.

## Workflow

`created → consented → recording → processing → clinician_review → signed → summary_approved → shared`

Transitions are deterministic commands. AI can propose content but cannot change approval state.

## First vertical slice

The first deployable slice uses a deterministic demo encounter derived from the golden blood-thinner case. The clinician can:

1. see live-style bilingual turns;
2. inspect the source for each PAC field;
3. resolve an uncertain medication field without a guessed drug name;
4. review completeness;
5. sign the note;
6. preview a patient-language handoff.

The Sarvam adapter starts behind an interface so the deterministic demo remains available when credentials or the network fail.

## Visual direction

The interface resembles a precise clinical working sheet rather than a generic AI dashboard.

- **Paper:** `#F7F8F5`
- **Ink:** `#17211D`
- **Deep green:** `#174C3C`
- **Clinical amber:** `#B66A19`
- **Alert red:** `#9F3A38`
- **Cool rule:** `#D6DDD8`

Typography uses Newsreader for restrained clinical headings, IBM Plex Sans for UI text, and IBM Plex Mono for timestamps and evidence IDs.

The signature element is an **evidence rail**: transcript turns appear as a narrow timed spine beside the PAC sheet, and selecting a proposed field visibly connects it to its exact source turn.

## Security

- Every exposed table has RLS enabled.
- Organization membership and encounter assignment govern access.
- Coordinator policies cannot sign notes.
- Signed note versions are immutable.
- Service/secret keys remain server-only.
- Authorization never uses user-editable metadata.
- Patient follow-up uses scoped, expiring access rather than direct clinical-table access.

