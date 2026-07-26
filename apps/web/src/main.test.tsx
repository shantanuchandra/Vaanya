import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type React from "react";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  document.body.innerHTML = "<div id=\"root\"></div>";
  window.history.pushState({}, "", "/");
});

it("renders conversation listings as a standalone recordings page", async () => {
  document.body.innerHTML = "<div id=\"root\"></div>";
  window.history.pushState({}, "", "/recordings");
  vi.doMock("./auth", () => ({
    createSupabaseAuth: () => null
  }));
  vi.doMock("./AuthGate", () => ({
    AuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
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
          status: "ready_for_review",
          answeredCount: 3,
          applicableCount: 4,
          criticalGapCount: 1,
          hasTranscript: true
        }
      ]
    }))
  );

  await import("./main");

  expect(
    await screen.findByRole("heading", { name: /conversation listings/i })
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/patient pac workflow/i)).not.toBeInTheDocument();
  expect(await screen.findByText("Shantanu Chandra")).toBeInTheDocument();
});
