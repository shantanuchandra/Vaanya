import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeEncounterSpeech } from "./api";
import { SpeechCapture } from "./SpeechCapture";

vi.mock("./api", () => ({
  transcribeEncounterSpeech: vi.fn()
}));

class FakeMediaRecorder {
  mimeType = "audio/webm";
  private listeners = new Map<string, Array<(event: { data: Blob }) => void>>();

  addEventListener(
    type: string,
    listener: (event: { data: Blob }) => void
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  start() {}

  stop() {
    for (const listener of this.listeners.get("dataavailable") ?? []) {
      listener({ data: new Blob(["recorded"], { type: this.mimeType }) });
    }
    for (const listener of this.listeners.get("stop") ?? []) {
      listener({ data: new Blob() });
    }
  }
}

describe("SpeechCapture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("measures and submits each additional patient interaction", async () => {
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }]
        })
      }
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.mocked(transcribeEncounterSpeech).mockResolvedValue({
      transcription: {
        requestId: "stt-1",
        transcript: "I become breathless after one flight.",
        languageCode: "en-IN",
        languageProbability: 0.97
      },
      suggestions: [],
      encounter: {
        id: "demo",
        patientReference: "Sulochana Patel",
        procedure: "Laparoscopic hernia repair",
        preferredLanguage: "en-IN",
        state: "clinician_review",
        consentRecorded: true,
        recordings: [],
        checklistContext: {
          templateId: "synthetic-pac",
          version: "synthetic-pac-v1",
          contextFlags: []
        },
        checklistSuggestions: [],
        checklistExtensions: [],
        requiredFieldIds: [],
        proposals: [],
        transcript: [],
        audit: []
      }
    });
    let nowMs = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    render(<SpeechCapture encounterId="demo" onEncounter={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Record additional interaction" })
    );
    const stopButton = await screen.findByRole("button", {
      name: "Stop & add to PAC"
    });
    nowMs = 22_400;
    fireEvent.click(stopButton);

    await waitFor(() =>
      expect(transcribeEncounterSpeech).toHaveBeenCalledWith(
        "demo",
        expect.any(Blob),
        "hi-IN",
        12.4
      )
    );
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
