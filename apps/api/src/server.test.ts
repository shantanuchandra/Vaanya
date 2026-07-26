import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildServer } from "./server";
import { createDemoEncounter } from "./demo-encounter";
import { MemoryEncounterStore } from "./encounter-store";
import type { DiarizedSegment, TranscriptionInput } from "./sarvam-client";

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
  it("returns the synthetic recordings worklist in processing priority order", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/recordings",
      headers: authorized
    });

    expect(response.statusCode).toBe(200);
    const items = response.json();
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({
      synthetic: true,
      status: "uploaded",
      patient: { displayName: "Kavya Nair" }
    });
    expect(
      items.map(
        (item: { patient: { displayName: string } }) =>
          item.patient.displayName
      )
    ).toContain("Ananya Rao");
  });

  it("translates the patient summary and synthesizes audio in the selected Sarvam language", async () => {
    const demoWithSummary = {
      ...createDemoEncounter(),
      customerSummary:
        "Your PAC recording is ready for doctor review. Please bring your medicine strip."
    };
    const calls: Array<{ kind: string; languageCode?: string; text: string }> = [];
    const server = await buildServer({
      store: new MemoryEncounterStore([demoWithSummary]),
      authenticator: testAuthenticator,
      sarvamClient: {
        transcribe: async () => {
          throw new Error("not used");
        },
        extractPacSuggestions: async () => [],
        translateToKannada: async input => ({
          requestId: "legacy-kn",
          translatedText: input
        }),
        synthesizeKannada: async text => ({
          requestId: "legacy-tts",
          audioBase64: Buffer.from(text).toString("base64")
        }),
        translateText: async input => {
          calls.push({
            kind: "translate",
            languageCode: input.targetLanguageCode,
            text: input.text
          });
          return {
            requestId: "translate-hi",
            translatedText: "आपकी पीएसी रिकॉर्डिंग डॉक्टर की समीक्षा के लिए तैयार है।"
          };
        },
        synthesizeSpeech: async input => {
          calls.push({
            kind: "speech",
            languageCode: input.languageCode,
            text: input.text
          });
          return {
            requestId: "speech-hi",
            audioBase64: "aGVsbG8="
          };
        }
      }
    });
    servers.push(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/patient-summary-handoff",
      headers: authorized,
      payload: { languageCode: "hi-IN" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceText: demoWithSummary.customerSummary,
      translatedText: expect.stringContaining("डॉक्टर"),
      languageCode: "hi-IN",
      audioBase64: "aGVsbG8=",
      audioMimeType: "audio/mpeg"
    });
    expect(calls).toEqual([
      {
        kind: "translate",
        languageCode: "hi-IN",
        text: demoWithSummary.customerSummary
      },
      {
        kind: "speech",
        languageCode: "hi-IN",
        text: "आपकी पीएसी रिकॉर्डिंग डॉक्टर की समीक्षा के लिए तैयार है।"
      }
    ]);
  });

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
      },
      openAiPacClient: {
        structurePacConversation: async () => {
          throw new Error("not used");
        },
        highlightEvidencePhrases: async () => [
          "khoon patla karne wali goli",
          "naam yaad nahi"
        ]
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
      url: "/api/encounters/demo/speech?languageCode=hi-IN&durationSeconds=12.4",
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
    expect(body.encounter.transcript.at(-1)).toMatchObject({
      evidencePhrases: [
        "khoon patla karne wali goli",
        "naam yaad nahi"
      ]
    });
    expect(body.encounter.recordings).toContainEqual(
      expect.objectContaining({
        sourceType: "microphone",
        durationSeconds: 12.4
      })
    );
    expect(JSON.stringify(body)).not.toMatch(/aspirin|stop before surgery/i);
  });

  it("does not count a microphone recording when transcription fails", async () => {
    const server = await buildServer({
      authenticator: testAuthenticator,
      sarvamClient: {
        transcribe: async () => {
          throw new Error("synthetic STT failure");
        },
        extractPacSuggestions: async () => [],
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
    const boundary = "----vaanaya-failed-recording";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="failed.webm"\r\nContent-Type: audio/webm\r\n\r\n`
      ),
      Buffer.from("synthetic-audio"),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/speech?languageCode=hi-IN&durationSeconds=9",
      headers: {
        ...authorized,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: multipart
    });
    const encounter = await server.inject({
      method: "GET",
      url: "/api/encounters/demo",
      headers: authorized
    });

    expect(response.statusCode).toBe(502);
    expect(encounter.json().recordings).toHaveLength(1);
  });

  it("creates a patient encounter and populates PAC fields plus next questions from a mocked recording", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);

    const patient = await server.inject({
      method: "POST",
      url: "/api/patients",
      headers: authorized,
      payload: {
        displayName: "Ravi Kumar",
        mobileNumber: "+919900001111"
      }
    });
    expect(patient.statusCode).toBe(201);

    const listed = await server.inject({
      method: "GET",
      url: "/api/patients?q=ravi",
      headers: authorized
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toContainEqual(
      expect.objectContaining({
        displayName: "Ravi Kumar",
        mobileLast4: "1111"
      })
    );

    const encounter = await server.inject({
      method: "POST",
      url: "/api/encounters",
      headers: authorized,
      payload: {
        patientId: patient.json().id,
        procedure: "Elective hernia repair",
        preferredLanguage: "hi-IN",
        sourceType: "uploaded_mp4"
      }
    });
    expect(encounter.statusCode).toBe(201);

    const recording = await server.inject({
      method: "POST",
      url: `/api/encounters/${encounter.json().id}/mock-recording`,
      headers: authorized,
      payload: {
        sourceType: "uploaded_mp4",
        transcript:
          "I take a blood thinner but I do not remember the name. I had fever last week."
      }
    });

    expect(recording.statusCode).toBe(200);
    expect(recording.json()).toMatchObject({
      patient: {
        displayName: "Ravi Kumar",
        mobileNumber: "+919900001111"
      },
      sourceType: "uploaded_mp4",
      state: "clinician_review"
    });
    expect(recording.json().proposals).toContainEqual(
      expect.objectContaining({
        id: "medications",
        state: "uncertain",
        value: expect.stringMatching(/blood thinner/i)
      })
    );
    expect(recording.json().recommendationQuestions).toContainEqual(
      expect.objectContaining({
        id: "medication-name",
        question: expect.stringMatching(/strip|prescription/i)
      })
    );

    const secondOpinion = await server.inject({
      method: "POST",
      url: `/api/encounters/${encounter.json().id}/second-opinion`,
      headers: authorized
    });
    expect(secondOpinion.statusCode).toBe(200);
    expect(secondOpinion.json()).toMatchObject({
      secondOpinionRequested: true,
      secondOpinionRequestedBy: "demo-clinician"
    });
    expect(secondOpinion.json().audit).toContainEqual(
      expect.objectContaining({
        action: "second_opinion.requested",
        actorId: "demo-clinician"
      })
    );
  });

  it("uploads the bundled example MP4 through Sarvam and appends it to the evidence rail", async () => {
    const exampleBytes = readFileSync(
      fileURLToPath(
        new URL("../../../Examples/WhatsApp Audio 2026-07-26 at 09.14.01.demo-29s.mp4", import.meta.url)
      )
    );
    const sarvamInputs: TranscriptionInput[] = [];
    const server = await buildServer({
      authenticator: testAuthenticator,
      sarvamClient: {
        transcribe: async input => {
          sarvamInputs.push(input);
          return {
            requestId: "sarvam-example-1",
            transcript:
              "Woh khoon patla karne wali goli leta hoon, naam yaad nahi.",
            languageCode: "hi-IN",
            languageProbability: 0.97
          };
        },
        extractPacSuggestions: async ({ turnId }) => [
          {
            field: "medications",
            state: "captured",
            value: "Blood thinner name not recalled.",
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

    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/example-recording?languageCode=hi-IN",
      headers: authorized
    });

    expect(response.statusCode).toBe(200);
    const capturedSarvamInput = sarvamInputs[0];
    expect(capturedSarvamInput).toBeDefined();
    if (!capturedSarvamInput) throw new Error("Sarvam was not called.");
    expect(capturedSarvamInput.filename).toBe(
      "WhatsApp Audio 2026-07-26 at 09.14.01.demo-29s.mp4"
    );
    expect(capturedSarvamInput.mimeType).toBe("audio/mp4");
    expect(Buffer.compare(Buffer.from(capturedSarvamInput.bytes), exampleBytes)).toBe(0);
    expect(response.json().transcription).toMatchObject({
      requestId: "sarvam-example-1",
      languageCode: "hi-IN"
    });
    expect(response.json().encounter.transcript.at(-1)).toMatchObject({
      speaker: "patient",
      original: expect.stringMatching(/khoon patla/i),
      confidence: 0.97
    });
    expect(response.json().encounter.proposals).toContainEqual(
      expect.objectContaining({
        id: "medications",
        state: "uncertain",
        sourceTurnIds: [expect.stringMatching(/^live-/)]
      })
    );
  });

  it("processes the complete synthetic recording into diarized PAC evidence", async () => {
    const fullBytes = readFileSync(
      fileURLToPath(
        new URL("../../../Examples/WhatsApp Audio 2026-07-26 at 09.14.01.mp4", import.meta.url)
      )
    );
    const segments: DiarizedSegment[] = [
      {
        id: "seg-1",
        speakerLabel: "Speaker 0",
        originalText: "Do you take any regular medicines?",
        translatedText: "Do you take any regular medicines?",
        startSeconds: 0,
        endSeconds: 1.8
      },
      {
        id: "seg-2",
        speakerLabel: "Speaker 1",
        originalText: "I take a blood thinner but forgot the name.",
        translatedText: "I take a blood thinner but forgot the name.",
        startSeconds: 2.1,
        endSeconds: 4.2
      }
    ];
    const sarvamInputs: TranscriptionInput[] = [];
    const openAiSegments: DiarizedSegment[][] = [];
    const server = await buildServer({
      authenticator: testAuthenticator,
      sarvamClient: {
        transcribe: async () => {
          throw new Error("REST STT should not be used for the full recording.");
        },
        processDiarizedTranslation: async input => {
          sarvamInputs.push(input);
          return { requestId: "sarvam-batch-1", segments };
        },
        extractPacSuggestions: async () => [],
        translateToKannada: async input => ({
          requestId: null,
          translatedText: input
        }),
        synthesizeKannada: async () => ({
          requestId: null,
          audioBase64: ""
        })
      },
      openAiPacClient: {
        structurePacConversation: async input => {
          openAiSegments.push(input);
          return {
            customerSummary:
              "Your pre-anaesthetic check-up was recorded for doctor review. Please bring your blood thinner strip because the exact name was not remembered.",
            turns: [
              {
                segmentId: "seg-1",
                speakerRole: "clinician",
                topic: "medications",
                uncertainty: false,
                evidencePhrases: ["regular medicines"]
              },
              {
                segmentId: "seg-2",
                speakerRole: "patient",
                topic: "medications",
                uncertainty: true,
                evidencePhrases: ["blood thinner", "forgot the name"]
              }
            ],
            checklistProposals: [
              {
                itemId: "medications",
                state: "uncertain",
                value: "Blood thinner reported; exact name not remembered.",
                sourceSegmentIds: ["seg-2"]
              }
            ]
          };
        }
      }
    });
    servers.push(server);

    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/complete-example-recording",
      headers: authorized
    });
    const cachedResponse = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/complete-example-recording",
      headers: authorized
    });

    expect(response.statusCode).toBe(200);
    expect(cachedResponse.statusCode).toBe(200);
    expect(cachedResponse.json()).toMatchObject({
      status: "cached",
      encounter: {
        transcript: response.json().encounter.transcript
      }
    });
    expect(sarvamInputs).toHaveLength(1);
    expect(openAiSegments).toHaveLength(1);
    expect(sarvamInputs[0]).toMatchObject({
      filename: "WhatsApp Audio 2026-07-26 at 09.14.01.mp4",
      mimeType: "audio/mp4",
      languageCode: "hi-IN"
    });
    expect(Buffer.compare(Buffer.from(sarvamInputs[0]?.bytes ?? []), fullBytes)).toBe(0);
    expect(openAiSegments[0]).toEqual(segments);
    expect(response.json()).toMatchObject({ status: "completed" });
    expect(response.json().encounter.customerSummary).toContain(
      "pre-anaesthetic check-up"
    );
    expect(response.json().encounter.transcript).toContainEqual(
      expect.objectContaining({
        id: "seg-2",
        speaker: "patient",
        language: "en-IN",
        original: "I take a blood thinner but forgot the name.",
        translation: "I take a blood thinner but forgot the name.",
        evidencePhrases: ["blood thinner", "forgot the name"],
        offsetSeconds: 2.1
      })
    );
    expect(response.json().encounter.recordings).toEqual([
      expect.objectContaining({
        sourceType: "uploaded_mp4",
        durationSeconds: 4.2
      })
    ]);
    expect(response.json().encounter.audit).toContainEqual(
      expect.objectContaining({
        action: "recording.synthetic_processed",
        detail: expect.objectContaining({
          syntheticDemo: true,
          sarvamRequestId: "sarvam-batch-1",
          segmentCount: 2,
          customerSummaryGenerated: true,
          topicCounts: { medications: 2 }
        })
      })
    );
  });

  it("processes a clinician-uploaded conversation file into diarized PAC evidence", async () => {
    const segments: DiarizedSegment[] = [
      {
        id: "upload-seg-1",
        speakerLabel: "Speaker 0",
        originalText: "Please confirm your medicine.",
        translatedText: "Please confirm your medicine.",
        startSeconds: 0,
        endSeconds: 1.5
      }
    ];
    const sarvamInputs: TranscriptionInput[] = [];
    const server = await buildServer({
      authenticator: testAuthenticator,
      sarvamClient: {
        transcribe: async () => {
          throw new Error("REST STT should not be used for uploaded PAC files.");
        },
        processDiarizedTranslation: async input => {
          sarvamInputs.push(input);
          return { requestId: "sarvam-upload-1", segments };
        },
        extractPacSuggestions: async () => [],
        translateToKannada: async input => ({
          requestId: null,
          translatedText: input
        }),
        synthesizeKannada: async () => ({
          requestId: null,
          audioBase64: ""
        })
      },
      openAiPacClient: {
        structurePacConversation: async input => ({
          customerSummary: "Uploaded PAC conversation is ready for doctor review.",
          turns: input.map(segment => ({
            segmentId: segment.id,
            speakerRole: "clinician",
            topic: "administrative",
            uncertainty: false,
            evidencePhrases: ["confirm your medicine"]
          })),
          checklistProposals: []
        })
      }
    });
    servers.push(server);
    const boundary = "----vaanaya-upload-test";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doctor-upload.mp4"\r\nContent-Type: audio/mp4\r\n\r\n`
      ),
      Buffer.from("uploaded-audio-bytes"),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/complete-recording",
      headers: {
        ...authorized,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: multipart
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "completed",
      filename: "doctor-upload.mp4",
      encounter: {
        customerSummary: "Uploaded PAC conversation is ready for doctor review."
      }
    });
    expect(sarvamInputs).toHaveLength(1);
    expect(sarvamInputs[0]).toMatchObject({
      filename: "doctor-upload.mp4",
      mimeType: "audio/mp4",
      languageCode: "hi-IN"
    });
    expect(Buffer.from(sarvamInputs[0]?.bytes ?? []).toString()).toBe(
      "uploaded-audio-bytes"
    );
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
    expect(response.headers["cache-control"]).toBe("no-store");
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

  it("allows a clinician to enter a checklist item", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({
      method: "PATCH",
      url: "/api/encounters/demo/checklist/documents",
      headers: authorized,
      payload: { value: "Prescription reviewed by clinician." }
    });

    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .checklist.items.find((item: { id: string }) => item.id === "documents")
    ).toMatchObject({
      status: "answered",
      sourceTurnIds: []
    });
  });

  it("rejects deferral of a non-deferrable checklist item", async () => {
    const server = await buildServer({ authenticator: testAuthenticator });
    servers.push(server);
    const response = await server.inject({
      method: "POST",
      url: "/api/encounters/demo/checklist/clinician_conclusion/defer",
      headers: authorized,
      payload: { reason: "Not completed" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/cannot be deferred/i);
  });

  it("reviews and publishes an OpenAI checklist for an unknown procedure", async () => {
    let unknownProcedureSuggestionCalls = 0;
    const server = await buildServer({
      authenticator: testAuthenticator,
      openAiPacClient: {
        structurePacConversation: async () => ({
          customerSummary: "Synthetic note for doctor review.",
          turns: [],
          checklistProposals: []
        }),
        suggestChecklistForUnknownProcedure: async () => ({
          modelRunId: `run-unknown-${++unknownProcedureSuggestionCalls}`,
          suggestions: [
            {
              categoryId: "history",
              question: "Was relevant reported history discussed?",
              rationale: "Supports procedure-specific documentation review."
            }
          ]
        })
      }
    });
    servers.push(server);
    const created = await server.inject({
      method: "POST",
      url: "/api/encounters",
      headers: authorized,
      payload: {
        patientId: "patient-demo-sulochana",
        procedure: "Unlisted synthetic procedure",
        preferredLanguage: "en-IN",
        sourceType: "uploaded_mp4"
      }
    });
    expect(created.statusCode).toBe(201);
    const encounter = created.json();
    expect(encounter.checklistSuggestions).toHaveLength(1);
    expect(encounter.checklistSuggestions[0].approvalState).toBe(
      "pending_clinician_review"
    );

    const pendingPublish = await server.inject({
      method: "POST",
      url: `/api/encounters/${encounter.id}/checklist-suggestions/publish`,
      headers: authorized
    });
    expect(pendingPublish.statusCode).toBe(409);

    const approved = await server.inject({
      method: "POST",
      url: `/api/encounters/${encounter.id}/checklist-suggestions/${encounter.checklistSuggestions[0].id}/approve`,
      headers: authorized
    });
    expect(approved.statusCode).toBe(200);

    const published = await server.inject({
      method: "POST",
      url: `/api/encounters/${encounter.id}/checklist-suggestions/publish`,
      headers: authorized
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().checklistLibrary).toMatchObject({
      normalizedProcedure: "unlisted synthetic procedure",
      version: 1
    });

    const reused = await server.inject({
      method: "POST",
      url: "/api/encounters",
      headers: authorized,
      payload: {
        patientId: "patient-demo-sulochana",
        procedure: "Unlisted synthetic procedure",
        preferredLanguage: "en-IN",
        sourceType: "uploaded_mp4"
      }
    });
    expect(reused.statusCode).toBe(201);
    expect(reused.json().checklistLibrary).toMatchObject({
      normalizedProcedure: "unlisted synthetic procedure",
      version: 1
    });
    expect(reused.json().checklistSuggestions).toEqual([]);
    expect(unknownProcedureSuggestionCalls).toBe(1);
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
