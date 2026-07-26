import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferChecklistItemRequest,
  getRecordings,
  processCompleteRecordingFile,
  setAccessTokenProvider,
  transcribeEncounterSpeech,
  transcribeAudio
} from "./api";

describe("speech API", () => {
  afterEach(() => {
    setAccessTokenProvider(async () => null);
    vi.unstubAllGlobals();
  });
  it("carries the authenticated clinician token to protected routes", async () => {
    setAccessTokenProvider(async () => "clinician-jwt");
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        requestId: "req-1",
        transcript: "नाम याद नहीं",
        languageCode: "hi-IN",
        languageProbability: null
      })
    });
    vi.stubGlobal("fetch", fetcher);

    await transcribeAudio(new Blob(["audio"], { type: "audio/webm" }), "hi-IN");

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer clinician-jwt"
    );
  });

  it("loads and validates the recordings worklist", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          encounterId: "demo",
          patient: {
            id: "patient-demo",
            displayName: "Shantanu Chandra",
            mobileNumber: "+919811110001",
            mobileLast4: "0001"
          },
          synthetic: true,
          procedure: "Laparoscopic hernia repair",
          preferredLanguage: "hi-IN",
          recordedAt: "2026-07-26T08:30:00.000Z",
          status: "uploaded",
          answeredCount: 2,
          applicableCount: 4,
          criticalGapCount: 1,
          hasTranscript: false
        }
      ]
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(getRecordings()).resolves.toHaveLength(1);
  });

  it("uploads microphone audio without putting credentials in the browser", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        requestId: "req-1",
        transcript: "नाम याद नहीं",
        languageCode: "hi-IN",
        languageProbability: null
      })
    });
    vi.stubGlobal("fetch", fetcher);

    const result = await transcribeAudio(
      new Blob(["audio"], { type: "audio/webm" }),
      "hi-IN"
    );

    expect(result.transcript).toBe("नाम याद नहीं");
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/speech/transcribe?languageCode=hi-IN");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("uses the encounter-scoped route when speech should create review suggestions", async () => {
    setAccessTokenProvider(async () => "clinician-jwt");
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transcription: {
          requestId: "req-2",
          transcript: "naam yaad nahi",
          languageCode: "hi-IN",
          languageProbability: 0.96
        },
        suggestions: [],
        encounter: {
          id: "demo",
          patientReference: "SYN-PAC-042",
          procedure: "Procedure",
          preferredLanguage: "hi-IN",
          state: "clinician_review",
          consentRecorded: true,
          requiredFieldIds: [],
          proposals: [],
          transcript: [],
          audit: []
        }
      })
    });
    vi.stubGlobal("fetch", fetcher);

    await transcribeEncounterSpeech(
      "demo",
      new Blob(["audio"], { type: "audio/webm" }),
      "hi-IN",
      12.4
    );

    expect(fetcher.mock.calls[0]![0]).toBe(
      "/api/encounters/demo/speech?languageCode=hi-IN&durationSeconds=12.4"
    );
  });

  it("uploads a selected PAC conversation file to the complete recording route", async () => {
    const uploaded = new File(["audio"], "doctor-upload.mp4", {
      type: "audio/mp4"
    });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        filename: "doctor-upload.mp4",
        encounter: {
          id: "demo",
          patientReference: "SYN-PAC-042",
          procedure: "Procedure",
          preferredLanguage: "hi-IN",
          state: "clinician_review",
          consentRecorded: true,
          requiredFieldIds: [],
          proposals: [],
          transcript: [],
          audit: []
        }
      })
    });
    vi.stubGlobal("fetch", fetcher);

    await processCompleteRecordingFile("demo", uploaded);

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/encounters/demo/complete-recording");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toMatchObject({
      name: "doctor-upload.mp4",
      type: "audio/mp4"
    });
  });

  it("records a clinician deferral reason through the checklist route", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "demo",
        patientReference: "SYN-PAC-042",
        procedure: "Procedure",
        preferredLanguage: "hi-IN",
        state: "clinician_review",
        consentRecorded: true,
        requiredFieldIds: [],
        proposals: [],
        transcript: [],
        audit: []
      })
    });
    vi.stubGlobal("fetch", fetcher);

    await deferChecklistItemRequest(
      "demo",
      "medical_history",
      "Outside records requested"
    );

    expect(fetcher.mock.calls[0]).toMatchObject([
      "/api/encounters/demo/checklist/medical_history/defer",
      {
        method: "POST",
        body: JSON.stringify({ reason: "Outside records requested" })
      }
    ]);
  });
});
