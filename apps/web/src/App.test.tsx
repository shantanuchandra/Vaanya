import { render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  it("opens a recording from the worklist in the existing evidence rail", async () => {
    const user = userEvent.setup();
    const shantanuEncounter = {
      ...demoEncounter,
      patient: {
        id: "patient-demo",
        displayName: "Shantanu Chandra",
        mobileNumber: "+919811110001",
        mobileLast4: "0001"
      },
      patientReference: "Shantanu Chandra",
      procedure: "Laparoscopic hernia repair"
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/recordings")) {
          return {
            ok: true,
            json: async () => [
              {
                encounterId: "demo",
                patient: shantanuEncounter.patient,
                synthetic: true,
                procedure: shantanuEncounter.procedure,
                preferredLanguage: "hi-IN",
                recordedAt: "2026-07-26T08:30:00.000Z",
                status: "ready_for_review",
                answeredCount: 3,
                applicableCount: 4,
                criticalGapCount: 1,
                hasTranscript: true
              }
            ]
          };
        }
        if (url.includes("/api/patients")) {
          return { ok: true, json: async () => [shantanuEncounter.patient] };
        }
        return { ok: true, json: async () => shantanuEncounter };
      })
    );

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Recordings" })
    );
    expect(
      await screen.findByRole("heading", { name: "Recordings" })
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /continue review.*shantanu chandra/i
      })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Listen once. Verify precisely."
      })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Shantanu Chandra").length).toBeGreaterThan(0);
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
      if (url.includes("/api/patients?q=ravi")) {
        return {
          ok: true,
          json: async () => [patient]
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

    await user.clear(await screen.findByLabelText(/find patient/i));
    await user.type(screen.getByLabelText(/find patient/i), "ravi");
    await user.clear(screen.getByLabelText(/procedure/i));
    await user.type(screen.getByLabelText(/procedure/i), "Elective hernia repair");
    await user.click(await screen.findByRole("button", { name: /ravi kumar/i }));
    await user.click(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    );

    expect(await screen.findByText("Current medicines")).toBeInTheDocument();
    expect(screen.getByText("Clinician-selected procedure")).toBeInTheDocument();
    expect(screen.getAllByText("Elective hernia repair").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/show the medicine strip or prescription/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ask for 2nd opinion/i }));
    expect(await screen.findByText(/2nd opinion raised/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /needs 2nd opinion/i }));
    expect(screen.getAllByText("Ravi Kumar").length).toBeGreaterThan(0);
  });

  it("shows the uncertainty before allowing sign-off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => demoEncounter
      })
    );

    render(<App />);

    expect(await screen.findByText("Current medicines")).toBeInTheDocument();
    expect(screen.getByText("Needs confirmation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign pac note/i })
    ).toBeDisabled();
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
    await user.type(await screen.findByLabelText(/find patient/i), "demo");

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
    await user.type(await screen.findByLabelText(/find patient/i), "demo");
    await user.click(
      await screen.findByRole("button", { name: /demo patient/i })
    );
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

    expect(await screen.findByText(/blood thinner/i)).toBeInTheDocument();
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
    await user.type(await screen.findByLabelText(/find patient/i), "demo");
    await user.click(
      await screen.findByRole("button", { name: /demo patient/i })
    );
    await user.click(
      screen.getByRole("button", { name: /upload complete synthetic recording/i })
    );

    expect(
      await screen.findByRole("region", { name: /customer summary drawer/i })
    ).toHaveTextContent(/bring your blood thinner strip/i);
    await user.click(screen.getByRole("button", { name: /mock email summary/i }));

    expect(screen.getByRole("status")).toHaveTextContent(
      /mock email queued for demo patient/i
    );
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
    await user.type(await screen.findByLabelText(/find patient/i), "demo");
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
