# Vaanaya MVP Application Implementation Plan

**Goal:** Deliver the signed-PAC vertical slice with a framework-neutral Sarvam adapter and Supabase-ready persistence.

## Ordered build

1. Create the npm workspace and environment contract.
2. Write shared workflow-contract tests, then implement transition guards.
3. Write the Supabase migration with indexed foreign keys, RLS, least-privilege policies, immutable signed versions, and audit append-only behavior.
4. Write Fastify API tests, then implement demo encounter, transition and health endpoints.
5. Build the React evidence-rail and PAC review sheet.
6. Connect UI to API with a deterministic fallback.
7. Run corpus tests, application tests, type checks, builds, and security scans.

## Acceptance

- Invalid workflow transitions are rejected.
- Signing requires clinician role and resolved required fields.
- No medication name is inferred in the blood-thinner case.
- Every proposed field displays source evidence.
- The UI works without live credentials using the deterministic adapter.
- Production builds succeed for web, API and shared contracts.

