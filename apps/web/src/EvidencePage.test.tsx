import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidencePage } from "./EvidencePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("timing evidence page", () => {
  it("makes no time-saving claim before paired observations are recorded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ observations: [], summary: null })
      })
    );

    render(<EvidencePage />);

    expect(
      await screen.findByText(/no measured time claim yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/60%/)).not.toBeInTheDocument();
  });
});
