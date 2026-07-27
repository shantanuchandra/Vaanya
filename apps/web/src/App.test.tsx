import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  window.history.replaceState({}, "", "/?encounter=demo");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const demoEncounter = {
  id: "demo",
  patient: {
    id: "patient-demo",
    displayName: "Demo Patient",
    mobileNumber: "+910000000000",
    mobileLast4: "0000"
  },
  patientReference: "SYN-PAC-042",
  procedure: "Elective abdominal procedure",
  preferredLanguage: "hi-IN",
  state: "clinician_review",
  consentRecorded: true,
  sourceType: "live",
  recommendationQuestions: [],
  requiredFieldIds: ["medications"],
  proposals: [
    {
      id: "medications",
      label: "Current medicines",
      state: "uncertain",
      value:
        "Patient describes a blood-thinning tablet; name unknown; last reported use was yesterday.",
      sourceTurnIds: ["t2"],
      required: true
    }
  ],
  transcript: [
    {
      id: "t2",
      speaker: "patient",
      language: "hi-IN",
      original:
        "Woh khoon patla karne wali goli leta hoon… naam yaad nahi… kal bhi li thi.",
      translation:
        "I take a blood-thinning tablet; I do not remember the name; I took it yesterday.",
      confidence: 0.92,
      offsetSeconds: 18
    }
  ],
  audit: []
};

describe("PAC review workspace", () => {
  it("lists only the three patients with the latest recordings", async () => {
    const recordings = [
      ["patient-old", "Old Patient", "2026-07-26T08:00:00.000Z"],
      ["patient-third", "Third Latest", "2026-07-26T10:00:00.000Z"],
      ["patient-new", "Newest Patient", "2026-07-26T12:00:00.000Z"],
      ["patient-second", "Second Latest", "2026-07-26T11:00:00.000Z"]
    ].map(([id, displayName, recordedAt], index) => ({
      encounterId: `encounter-${index}`,
      patient: {
        id,
        displayName,
        mobileNumber: `+91900000000${index}`,
        mobileLast4: `000${index}`
      },
      synthetic: true,
      procedure: "Synthetic PAC",
      preferredLanguage: "hi-IN",
      recordedAt,
      status: "ready_for_review",
      answeredCount: 1,
      applicableCount: 2,
      criticalGapCount: 1,
      hasTranscript: true
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        json: async () =>
          String(input).includes("/api/recordings")
            ? recordings
            : demoEncounter
      }))
    );

    render(<App />);

    expect(await screen.findByText("Newest Patient")).toBeInTheDocument();
    expect(screen.getByText("Second Latest")).toBeInTheDocument();
    expect(screen.getByText("Third Latest")).toBeInTheDocument();
    expect(screen.queryByText("Old Patient")).not.toBeInTheDocument();
  });

  it("keeps the draft and evidence rail empty on a plain page load", async () => {
    window.history.replaceState({}, "", "/");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/patients")) {
        return {
          ok: true,
          json: async () => []
        };
      }
      return {
        ok: true,
        json: async () => demoEncounter
      };
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);

    expect(
      await screen.findByText("Clinician-controlled draft")
    ).toBeInTheDocument();
    expect(screen.getByText("Evidence rail")).toBeInTheDocument();
    expect(
      screen.queryByText(demoEncounter.transcript[0]?.original ?? "")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Current or recent medicines")
    ).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(([input]) =>
        String(input).includes("/api/encounters/")
      )
    ).toBe(false);
  });

  it("previews the selected conversation recording immediately before upload", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(
      (file: Blob) => `blob:preview-${(file as File).name}`
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => demoEncounter
      }))
    );

    const { container } = render(<App />);

    const input = await screen.findByLabelText(/conversation recording file/i);
    const firstFile = new File(["first audio"], "first-pac.mp3", {
      type: "audio/mpeg"
    });

    await user.upload(input, firstFile);

    const preview = container.querySelector(".selected-recording-preview audio");
    expect(preview).toHaveAttribute("src", "blob:preview-first-pac.mp3");
    expect(screen.getByText("first-pac.mp3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload selected conversation/i })
    ).toBeInTheDocument();

    const secondFile = new File(["second audio"], "second-pac.wav", {
      type: "audio/wav"
    });
    await user.upload(input, secondFile);

    expect(
      container.querySelector(".selected-recording-preview audio")
    ).toHaveAttribute("src", "blob:preview-second-pac.wav");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-first-pac.mp3");
  });

  it("shows real recording totals and highlights OpenAI-grounded evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...demoEncounter,
          recordings: [
            {
              id: "r1",
              sourceType: "uploaded_mp4",
              durationSeconds: 76,
              recordedAt: "2026-07-26T09:14:01.000Z"
            },
            {
              id: "r2",
              sourceType: "microphone",
              durationSeconds: 12.4,
              recordedAt: "2026-07-26T09:20:00.000Z"
            }
          ],
          transcript: [
            {
              ...demoEncounter.transcript[0],
              evidencePhrases: [
                "blood-thinning tablet",
                "do not remember the name",
                "yesterday"
              ]
            }
          ]
        })
      }))
    );

    const { container } = render(<App />);

    expect(await screen.findByText("2 recordings")).toBeInTheDocument();
    expect(screen.getByText("1:28")).toBeInTheDocument();
    expect(screen.queryByText("01:16")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record additional interaction" })
    ).toBeInTheDocument();
    expect(container.querySelectorAll("mark")).toHaveLength(3);
  });

  it("keeps conversation listings out of the review page and links to the standalone page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => demoEncounter
      }))
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Listen once. Verify precisely."
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Recordings" })).toHaveAttribute(
      "href",
      "/recordings"
    );
    expect(
      screen.queryByRole("heading", { name: /conversation listings/i })
    ).not.toBeInTheDocument();
  });

  it("lets a doctor choose a patient, upload the complete synthetic recording, and review generated next questions", async () => {
    const user = userEvent.setup();
    const patient = {
      id: "patient-1",
      displayName: "Ravi Kumar",
      mobileNumber: "+919900001111",
      mobileLast4: "1111"
    };
    const generatedEncounter = {
      ...demoEncounter,
      id: "enc-1",
      patientReference: "Ravi Kumar",
      patient,
      procedure: "Elective hernia repair",
      sourceType: "uploaded_mp4",
      recommendationQuestions: [
        {
          id: "medication-name",
          question: "Ask the patient to show the medicine strip or prescription.",
          reason: "Blood thinner name is unknown."
        }
      ]
    };
    const secondOpinionEncounter = {
      ...generatedEncounter,
      secondOpinionRequested: true,
      secondOpinionRequestedBy: "demo-clinician",
      secondOpinionRequestedAt: "2026-07-26T07:30:00.000Z"
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/recordings")) {
        return {
          ok: true,
          json: async () => [
            {
              encounterId: "enc-ravi",
              patient,
              synthetic: true,
              procedure: "Elective hernia repair",
              preferredLanguage: "hi-IN",
              recordedAt: "2026-07-26T12:00:00.000Z",
              status: "ready_for_review",
              answeredCount: 1,
              applicableCount: 2,
              criticalGapCount: 1,
              hasTranscript: true
            }
          ]
        };
      }
      if (url.endsWith("/api/patients")) {
        return {
          ok: true,
          json: async () => [patient]
        };
      }
      if (url.includes("/second-opinion")) {
        return {
          ok: true,
          json: async () => secondOpinionEncounter
        };
      }
      if (url.endsWith("/api/encounters")) {
        return {
          ok: true,
          json: async () => generatedEncounter
        };
      }
      if (url.includes("/complete-example-recording")) {
        return {
          ok: true,
          json: async () => ({
            status: "completed",
            encounter: generatedEncounter
          })
        };
      }
      return {
        ok: true,
        json: async () => demoEncounter
      };
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);

    await user.clear(screen.getByLabelText(/procedure/i));
    await user.type(screen.getByLabelText(/procedure/i), "Elective hernia repair");
    await user.click(await screen.findByRole("button", { name: /ravi kumar/i }));
    await user.click(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    );

    expect(
      (await screen.findAllByText("Current or recent medicines")).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Clinician-selected procedure")).toBeInTheDocument();
    expect(screen.getAllByText("Elective hernia repair").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/show the medicine strip or prescription/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ask for 2nd opinion/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /highlighted in conversation listings/i
    );
    expect(
      screen.queryByRole("button", { name: /needs 2nd opinion/i })
    ).not.toBeInTheDocument();
  });

  it("keeps sign-off actionable while showing unresolved checklist blockers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => demoEncounter
      })
    );

    render(<App />);

    expect(
      (await screen.findAllByText("Current or recent medicines")).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Needs confirmation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign pac note/i })
    ).toBeEnabled();
  });

  it("keeps the loaded encounter patient selectable when patient search is unavailable", async () => {
    const user = userEvent.setup();
    const processedEncounter = {
      ...demoEncounter,
      procedure: "Elective demo procedure",
      recommendationQuestions: [
        {
          id: "medication-name",
          question: "Ask the patient to show the medicine strip or prescription.",
          reason: "Blood thinner name is unknown."
        }
      ]
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/patients")) {
          return {
            ok: false,
            json: async () => ({ message: "Search unavailable" })
          };
        }
        if (String(input).includes("/complete-example-recording")) {
          return {
            ok: true,
            json: async () => ({
              status: "completed",
              encounter: processedEncounter
            })
          };
        }
        return {
          ok: true,
          json: async () => demoEncounter
        };
      });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    expect(
      await screen.findByRole("button", { name: /demo patient/i })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /demo patient/i }));
    await user.clear(screen.getByLabelText(/procedure/i));
    await user.type(screen.getByLabelText(/procedure/i), "Elective demo procedure");
    await user.click(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    );

    expect(
      await screen.findByText(/show the medicine strip or prescription/i)
    ).toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/encounters") && init?.method === "POST"
      )
    ).toBe(false);
  });

  it("uses the complete synthetic recording path and updates the evidence rail", async () => {
    const user = userEvent.setup();
    const processedEncounter = {
      ...demoEncounter,
      transcript: [
        ...demoEncounter.transcript,
        {
          id: "seg-2",
          speaker: "patient",
          language: "en-IN",
          original:
            "I take a blood thinner but forgot the name.",
          translation:
            "I take a blood thinner but forgot the name.",
          confidence: 0.9,
          offsetSeconds: 2.1
        }
      ],
      proposals: [
        {
          id: "medications",
          label: "Current medicines",
          state: "uncertain",
          value:
            "Patient describes a blood-thinning tablet; exact name is not recalled.",
          sourceTurnIds: ["seg-2"],
          required: true
        }
      ],
      audit: [
        {
          id: "audit-1",
          action: "recording.synthetic_processed",
          actorId: "demo-clinician",
          occurredAt: "2026-07-26T08:00:00.000Z",
          detail: { syntheticDemo: true }
        }
      ]
    };
    let resolveExampleUpload: (value: unknown) => void = () => {};
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/patients")) {
        return {
          ok: true,
          json: async () => [demoEncounter.patient]
        };
      }
      if (url.includes("/complete-example-recording")) {
        return await new Promise(resolve => {
          resolveExampleUpload = resolve;
        });
      }
      return {
        ok: true,
        json: async () => demoEncounter
      };
      }
    );
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    await screen.findByRole("button", { name: /demo patient/i });
    await user.click(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    );

    expect(
      await screen.findByRole("button", { name: /diarizing and translating with sarvam/i })
    ).toBeDisabled();
    resolveExampleUpload?.({
      ok: true,
      json: async () => ({
        status: "completed",
        encounter: processedEncounter
      })
    });

    expect((await screen.findAllByText(/blood thinner/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/90% confidence/i)).toBeInTheDocument();
    const completeUploadCall = (
      fetcher.mock.calls as unknown as Array<
        [RequestInfo | URL, RequestInit | undefined]
      >
    ).find(([input]) => String(input).includes("/complete-example-recording"));
    expect(completeUploadCall?.[1]).toMatchObject({ method: "POST" });
    expect(
      (completeUploadCall?.[1]?.headers as Headers).has("content-type")
    ).toBe(false);
    expect(
      screen.getByText(/Synthetic demo recording - clinician review required/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Sarvam translated evidence/i)).toBeInTheDocument();
  });

  it("lets the clinician upload a selected conversation file", async () => {
    const user = userEvent.setup();
    const uploadedEncounter = {
      ...demoEncounter,
      transcript: [
        ...demoEncounter.transcript,
        {
          id: "upload-seg-1",
          speaker: "patient",
          language: "en-IN",
          original: "I take a blood thinner but forgot the name.",
          translation: "I take a blood thinner but forgot the name.",
          confidence: 0.9,
          offsetSeconds: 2.1
        }
      ],
      customerSummary: "Uploaded PAC conversation is ready for doctor review."
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/recordings")) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes("/api/patients")) {
        return {
          ok: true,
          json: async () => [demoEncounter.patient]
        };
      }
      if (url.includes("/complete-recording")) {
        return {
          ok: true,
          json: async () => ({
            status: "completed",
            filename: "suruchi-pac.mp4",
            encounter: uploadedEncounter
          })
        };
      }
      return {
        ok: true,
        json: async () => demoEncounter
      };
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /demo patient/i })
    );
    const file = new File(["audio"], "suruchi-pac.mp4", { type: "audio/mp4" });
    await user.upload(screen.getByLabelText(/conversation recording file/i), file);

    expect(screen.getByText(/suruchi-pac.mp4/i)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /upload selected conversation/i })
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /suruchi-pac\.mp4 processed/i
    );
    const uploadCall = (
      fetcher.mock.calls as unknown as Array<
        [RequestInfo | URL, RequestInit | undefined]
      >
    ).find(([input]) => String(input).includes("/complete-recording"));
    expect(uploadCall?.[1]?.body).toBeInstanceOf(FormData);
    expect((uploadCall?.[1]?.body as FormData).get("file")).toMatchObject({
      name: "suruchi-pac.mp4",
      type: "audio/mp4"
    });
  });

  it("shows the customer summary drawer and mocks sending it by email", async () => {
    const user = userEvent.setup();
    const processedEncounter = {
      ...demoEncounter,
      customerSummary:
        "Your pre-anaesthetic check-up was recorded for doctor review. Please bring your blood thinner strip because the exact name was not remembered.",
      audit: [
        {
          id: "audit-1",
          action: "recording.synthetic_processed",
          actorId: "demo-clinician",
          occurredAt: "2026-07-26T08:00:00.000Z",
          detail: { syntheticDemo: true }
        }
      ]
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/recordings")) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes("/api/patients")) {
        return { ok: true, json: async () => [demoEncounter.patient] };
      }
      if (url.includes("/complete-example-recording")) {
        return {
          ok: true,
          json: async () => ({ status: "completed", encounter: processedEncounter })
        };
      }
      return { ok: true, json: async () => demoEncounter };
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    await screen.findByRole("button", { name: /demo patient/i });
    await user.click(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    );

    const openSummary = await screen.findByRole("button", {
      name: /open customer summary/i
    });
    expect(
      screen.queryByRole("region", { name: /customer summary drawer/i })
    ).not.toBeInTheDocument();
    await user.click(openSummary);

    expect(
      await screen.findByRole("region", { name: /customer summary drawer/i })
    ).toHaveTextContent(/bring your blood thinner strip/i);
    await user.click(screen.getByRole("button", { name: /mock email summary/i }));

    expect(screen.getByRole("status")).toHaveTextContent(
      /mock email queued for demo patient/i
    );
    await user.click(
      screen.getByRole("button", { name: /close customer summary/i })
    );
    expect(
      screen.queryByRole("region", { name: /customer summary drawer/i })
    ).not.toBeInTheDocument();
  });

  it("lets the doctor switch patient summary language and play generated audio in the drawer", async () => {
    const user = userEvent.setup();
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const processedEncounter = {
      ...demoEncounter,
      customerSummary:
        "Your PAC recording is ready for doctor review. Please bring your medicine strip.",
      audit: [
        {
          id: "audit-1",
          action: "recording.synthetic_processed",
          actorId: "demo-clinician",
          occurredAt: "2026-07-26T08:00:00.000Z",
          detail: { syntheticDemo: true }
        }
      ]
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/patients")) {
        return { ok: true, json: async () => [demoEncounter.patient] };
      }
      if (url.includes("/complete-example-recording")) {
        return {
          ok: true,
          json: async () => ({ status: "completed", encounter: processedEncounter })
        };
      }
      if (url.includes("/patient-summary-handoff")) {
        expect(JSON.parse(String(init?.body))).toEqual({ languageCode: "hi-IN" });
        return {
          ok: true,
          json: async () => ({
            sourceText: processedEncounter.customerSummary,
            translatedText:
              "आपकी पीएसी रिकॉर्डिंग डॉक्टर की समीक्षा के लिए तैयार है।",
            languageCode: "hi-IN",
            audioBase64: "aGVsbG8=",
            audioMimeType: "audio/mpeg"
          })
        };
      }
      return { ok: true, json: async () => demoEncounter };
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /demo patient/i })
    );
    await user.click(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    );

    await user.click(
      await screen.findByRole("button", { name: /open customer summary/i })
    );
    expect(
      await screen.findByRole("region", { name: /customer summary drawer/i })
    ).toHaveTextContent(/ready for doctor review/i);
    await user.selectOptions(
      screen.getByLabelText(/patient language/i),
      "hi-IN"
    );
    await user.click(
      screen.getByRole("button", { name: /generate patient audio/i })
    );

    expect(await screen.findByText(/आपकी पीएसी रिकॉर्डिंग/i)).toBeInTheDocument();
    const audio = screen.getByLabelText(/play patient summary audio/i);
    expect(audio).toHaveAttribute(
      "src",
      "data:audio/mpeg;base64,aGVsbG8="
    );
    await user.click(
      screen.getByRole("button", { name: "Play patient audio" })
    );
    expect(play).toHaveBeenCalledOnce();
    fireEvent.play(audio);
    expect(
      screen.getByRole("button", { name: "Replay patient audio" })
    ).toBeInTheDocument();
  });

  it("uploads the complete synthetic recording and shows translated diarized evidence", async () => {
    const user = userEvent.setup();
    const processedEncounter = {
      ...demoEncounter,
      sourceType: "uploaded_mp4",
      transcript: [
        {
          id: "seg-1",
          speaker: "clinician",
          language: "en-IN",
          original: "Do you take any regular medicines?",
          translation: "Do you take any regular medicines?",
          confidence: 0.9,
          offsetSeconds: 0
        },
        {
          id: "seg-2",
          speaker: "patient",
          language: "en-IN",
          original: "I take a blood thinner but forgot the name.",
          translation: "I take a blood thinner but forgot the name.",
          confidence: 0.9,
          offsetSeconds: 2.1
        }
      ],
      proposals: [
        {
          id: "medications",
          label: "Current medicines",
          state: "uncertain",
          value:
            "Patient reports a blood thinner, but the exact medicine name is not recalled.",
          sourceTurnIds: ["seg-2"],
          required: true
        }
      ],
      audit: [
        {
          id: "audit-1",
          action: "recording.synthetic_processed",
          actorId: "demo-clinician",
          occurredAt: "2026-07-26T08:00:00.000Z",
          detail: {
            syntheticDemo: true,
            topicCounts: { medications: 2 }
          }
        }
      ]
    };
    let resolveUpload: (value: unknown) => void = () => {};
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/patients")) {
        return {
          ok: true,
          json: async () => [demoEncounter.patient]
        };
      }
      if (url.includes("/complete-example-recording")) {
        return await new Promise(resolve => {
          resolveUpload = resolve;
        });
      }
      return {
        ok: true,
        json: async () => demoEncounter
      };
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /demo patient/i })
    );
    await user.click(
      screen.getByRole("button", {
        name: /upload complete synthetic recording/i
      })
    );

    expect(
      await screen.findByRole("button", {
        name: /diarizing and translating with sarvam/i
      })
    ).toBeDisabled();
    expect(
      screen.getByRole("status", {
        name: ""
      })
    ).toHaveTextContent(
      "Uploading WhatsApp Audio 2026-07-26 at 09.14.01.mp4"
    );
    resolveUpload?.({
      ok: true,
      json: async () => ({
        status: "completed",
        encounter: processedEncounter
      })
    });

    expect(
      await screen.findByText(
        /Synthetic demo recording - clinician review required/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText("patient")).toBeInTheDocument();
    expect(screen.getByText("0:02")).toBeInTheDocument();
    expect(screen.getAllByText(/blood thinner/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Sarvam translated evidence/i)).toBeInTheDocument();
    const fetchCalls = fetcher.mock.calls as unknown as Array<
      [RequestInfo | URL, RequestInit | undefined]
    >;
    const completeUploadCall = fetchCalls.find(([input]) =>
      String(input).includes("/complete-example-recording")
    );
    expect(completeUploadCall?.[1]).toMatchObject({ method: "POST" });
    expect(
      (completeUploadCall?.[1]?.headers as Headers).has("content-type")
    ).toBe(false);
  });

  it("reveals the original source utterance from the field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => demoEncounter
      })
    );
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /view source/i }));

    const sourceUtterance = screen.getByText(
      /Woh khoon patla karne wali goli/i
    );
    expect(sourceUtterance.closest(".evidence-turn")).toHaveClass("is-active");
  });

  it("offers a printable hospital artifact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => demoEncounter
      })
    );
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const user = userEvent.setup();

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /print or save pdf/i })
    );

    expect(print).toHaveBeenCalledOnce();
  });
});
