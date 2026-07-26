import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
const authorized = {
  authorization: "Bearer valid-token"
};
const testAuthenticator = {
  authenticate: async (token: string) =>
    token === "valid-token"
      ? {
          id: "demo-clinician",
          email: "doctor@example.test",
          organizationId: "org-1",
          role: "clinician" as const
        }
      : null
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

describe("encounter API", () => {
  it("rejects protected encounter access without a bearer token", async () => {
    const server = await buildServer({
      authenticator: {
        authenticate: async () => null
      }
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/encounters/demo"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("uses the validated clinician identity instead of a client actor id", async () => {
    const server = await buildServer({
      authenticator: {
        authenticate: async token =>
          token === "valid-token"
            ? {
                id: "verified-clinician",
                email: "doctor@example.test",
                organizationId: "org-1",
                role: "clinician"
              }
            : null
      }
    });
    servers.push(server);

    const resolution = await server.inject({
      method: "PATCH",
      url: "/api/encounters/demo/proposals/medications",
      headers: { authorization: "Bearer valid-token" },
      payload: {
        value: "Exact medicine verified from the patient-carried strip.",
        actorId: "forged-browser-user"
      }
    });

    expect(resolution.statusCode).toBe(200);
    expect(resolution.json().audit.at(-1)).toMatchObject({
      actorId: "verified-clinician"
    });
  });

  it("serves a 15-case anesthesiologist review queue and resumes saved feedback", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);

    const queue = await server.inject({
      method: "GET",
      url: "/api/reviews/golden-cases",
      headers: authorized
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().cases).toHaveLength(15);
    expect(queue.json().cases[0]).toMatchObject({
      caseId: expect.stringMatching(/^PAC-SYN-/),
      review: null
    });

    const saved = await server.inject({
      method: "PUT",
      url: `/api/reviews/golden-cases/${queue.json().cases[0].caseId}`,
      headers: authorized,
      payload: {
        verdict: "needs_revision",
        notes: "Clarification should explicitly request the medicine strip.",
        confidence: 4
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      verdict: "needs_revision",
      reviewerId: "demo-clinician"
    });

    const resumed = await server.inject({
      method: "GET",
      url: "/api/reviews/golden-cases",
      headers: authorized
    });
    expect(resumed.json().cases[0].review).toMatchObject({
      verdict: "needs_revision",
      confidence: 4
    });
  });

  it("rejects an invalid golden-case verdict", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({
      method: "PUT",
      url: "/api/reviews/golden-cases/PAC-SYN-0001",
      headers: authorized,
      payload: { verdict: "looks_good", notes: "", confidence: 8 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_REVIEW" });
  });

  it("does not claim time reduction until paired observations exist", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const empty = await server.inject({
      method: "GET",
      url: "/api/evidence/timing",
      headers: authorized
    });

    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      observations: [],
      summary: null
    });
  });

  it("derives timing evidence from saved paired observations", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);

    for (const payload of [
      {
        scenarioId: "PAC-SYN-0005",
        paperSeconds: 1200,
        vaanayaSeconds: 480,
        paperCorrections: 3,
        vaanayaCorrections: 1,
        notes: "Medication ambiguity case"
      },
      {
        scenarioId: "PAC-SYN-0721",
        paperSeconds: 900,
        vaanayaSeconds: 360,
        paperCorrections: 2,
        vaanayaCorrections: 1,
        notes: "Fasting correction case"
      },
      {
        scenarioId: "PAC-SYN-0866",
        paperSeconds: 1500,
        vaanayaSeconds: 600,
        paperCorrections: 4,
        vaanayaCorrections: 2,
        notes: "Prior anesthesia recall case"
      }
    ]) {
      const saved = await server.inject({
        method: "PUT",
        url: `/api/evidence/timing/${payload.scenarioId}`,
        headers: authorized,
        payload
      });
      expect(saved.statusCode).toBe(200);
    }

    const evidence = await server.inject({
      method: "GET",
      url: "/api/evidence/timing",
      headers: authorized
    });
    expect(evidence.json().summary).toEqual({
      pairedObservations: 3,
      medianPaperSeconds: 1200,
      medianVaanayaSeconds: 480,
      medianReductionPercent: 60
    });
  });

  it("adds live ambiguous medication speech only as a source-linked uncertain proposal", async () => {
    const server = await buildServer({
      authenticator: testAuthenticator,
      sarvamClient: {
        transcribe: async () => ({
          requestId: "stt-1",
          transcript:
            "Woh khoon patla karne wali goli leta hoon, naam yaad nahi.",
          languageCode: "hi-IN",
          languageProbability: 0.98
        }),
        extractPacSuggestions: async ({ turnId }) => [
          {
            field: "medications",
            state: "captured",
            value: "Aspirin; stop before surgery.",
            sourceTurnIds: [turnId]
          }
        ],
        translateToKannada: async input => ({
          requestId: null,
          translatedText: input
        }),
        synthesizeKannada: async () => ({
          requestId: null,
          audioBase64: ""
        })
      }
    });
    servers.push(server);
    const boundary = "----vaanaya-test";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="patient.webm"\r\nContent-Type: audio/webm\r\n\r\n`
      ),
      Buffer.from("synthetic-audio"),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/speech?languageCode=hi-IN",
      headers: {
        ...authorized,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: multipart
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.transcription.transcript).toContain("khoon patla");
    expect(body.suggestions[0]).toMatchObject({
      field: "medications",
      state: "uncertain"
    });
    expect(body.suggestions[0].sourceTurnIds).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/aspirin|stop before surgery/i);
  });

  it("reports adapter readiness without exposing secrets", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      mode: "deterministic-demo",
      sarvamConfigured: false,
      supabaseConfigured: false,
      telegramConfigured: false
    });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["content-security-policy"]).toContain(
      "connect-src 'self'"
    );
  });

  it("serves the shareable clinical review page directly", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/review" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("allows the configured Supabase Auth origin in browser CSP", async () => {
    const previous = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://project-ref.supabase.co";
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/review" });
    if (previous) process.env.SUPABASE_URL = previous;
    else delete process.env.SUPABASE_URL;

    expect(response.headers["content-security-policy"]).toContain(
      "connect-src 'self' https://project-ref.supabase.co"
    );
  });

  it("returns the source-linked blood-thinner demo encounter", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({
      method: "GET",
      url: "/api/encounters/demo",
      headers: authorized
    });

    expect(response.statusCode).toBe(200);
    const encounter = response.json();
    expect(encounter.state).toBe("clinician_review");
    expect(
      encounter.proposals.find(
        (proposal: { id: string }) => proposal.id === "medications"
      )
    ).toMatchObject({
      id: "medications",
      state: "uncertain",
      sourceTurnIds: ["t2"]
    });
  });

  it("refuses to sign while medication remains uncertain", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/sign",
      headers: authorized,
      payload: { actorId: "demo-clinician", actorRole: "clinician" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "WORKFLOW_CONFLICT"
    });
  });

  it("refuses patient-language handoff before clinician sign-off", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/kannada-handoff",
      headers: authorized
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "HANDOFF_NOT_APPROVED"
    });
  });

  it("refuses Telegram delivery before clinician sign-off", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/telegram-handoff",
      headers: authorized
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "HANDOFF_NOT_APPROVED"
    });
  });

  it("resolves the medication and signs without inventing a drug name", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);

    const resolution = await server.inject({
      method: "PATCH",
      url: "/api/encounters/demo/proposals/medications",
      headers: authorized,
      payload: {
        value:
          "Medicine strip reviewed by clinician; exact entry recorded in the signed note.",
        actorId: "demo-clinician"
      }
    });
    expect(resolution.statusCode).toBe(200);

    const signing = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/sign",
      headers: authorized,
      payload: { actorId: "demo-clinician", actorRole: "clinician" }
    });

    expect(signing.statusCode).toBe(200);
    expect(signing.json()).toMatchObject({ state: "signed" });
    expect(JSON.stringify(signing.json())).not.toMatch(/aspirin|clopidogrel/i);
  });
});
