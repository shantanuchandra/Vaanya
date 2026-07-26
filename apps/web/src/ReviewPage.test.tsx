import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccessTokenProvider } from "./api";
import { ReviewPage } from "./ReviewPage";

afterEach(() => {
  cleanup();
  setAccessTokenProvider(async () => null);
  vi.unstubAllGlobals();
});

describe("golden-case clinical review", () => {
  it("captures a revision verdict and advances to the next case", async () => {
    setAccessTokenProvider(async () => "clinician-token");
    const cases = [
      {
        caseId: "PAC-SYN-0005",
        title: "Colloquial blood-thinner description",
        language: { path: "hi-hinglish", primary: "hi-IN", codeMixed: true },
        difficulty: "D4",
        conversation: [
          {
            turnId: "t2",
            speaker: "patient",
            language: "hi-IN",
            text: "Blood thin karne ki tablet hai, name bhool gaya.",
            confidence: 0.99
          }
        ],
        expectedPac: {
          medications: {
            state: "uncertain",
            value: "Blood-thinning tablet reported; name unknown.",
            sourceTurnIds: ["t2"]
          }
        },
        requiredClarifications: [
          { intent: "confirm", prompt: "Please show the medicine strip." }
        ],
        prohibitedInferences: ["infer_anticoagulant_class"],
        review: null
      },
      {
        caseId: "PAC-SYN-0006",
        title: "Remote event recalled",
        language: { path: "hi-hinglish", primary: "hi-IN", codeMixed: true },
        difficulty: "D4",
        conversation: [],
        expectedPac: {},
        requiredClarifications: [],
        prohibitedInferences: [],
        review: null
      }
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cases, completed: 0, total: 2 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          caseId: "PAC-SYN-0005",
          verdict: "needs_revision",
          notes: "Prompt should request a prescription too.",
          confidence: 4,
          reviewerId: "doctor-1",
          reviewedAt: "2026-07-26T06:00:00.000Z"
        })
      });
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();

    render(<ReviewPage />);
    expect(
      await screen.findByText("Colloquial blood-thinner description")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /needs revision/i }));
    await user.type(
      screen.getByLabelText(/clinical correction notes/i),
      "Prompt should request a prescription too."
    );
    await user.click(screen.getByRole("button", { name: /save & next case/i }));

    expect(await screen.findByText("Remote event recalled")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
