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
  patientReference: "SYN-PAC-042",
  procedure: "Elective abdominal procedure",
  preferredLanguage: "hi-IN",
  state: "clinician_review",
  consentRecorded: true,
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
