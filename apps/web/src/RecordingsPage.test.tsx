import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { RecordingsPage } from "./RecordingsPage";

it("shows synthetic recording status and opens existing evidence review", async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();

  render(
    <RecordingsPage
      loading={false}
      recordings={[
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
      ]}
      onOpen={onOpen}
      onProcess={vi.fn()}
    />
  );

  expect(screen.getByText("Synthetic demo data")).toBeInTheDocument();
  expect(screen.getByText("3 of 4 answered")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: /continue review.*shantanu chandra/i
    })
  );
  expect(onOpen).toHaveBeenCalledWith("demo");
});
