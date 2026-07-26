import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRecordings,
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
      "hi-IN"
    );

    expect(fetcher.mock.calls[0]![0]).toBe(
      "/api/encounters/demo/speech?languageCode=hi-IN"
    );
  });
});
