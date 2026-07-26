import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { evaluateChecklist } from "@vaanaya/contracts";
import { expect, it, vi } from "vitest";
import { PacChecklist } from "./PacChecklist";

it("groups PAC items, exposes gaps, and selects source-linked evidence", async () => {
  const user = userEvent.setup();
  const onSelectItem = vi.fn();
  const checklist = evaluateChecklist({
    procedure: "Laparoscopic hernia repair",
    contextFlags: [],
    transcript: [{ id: "t2" }],
    proposals: [
      {
        id: "medications",
        state: "uncertain",
        value: "Blood thinner; exact name unknown.",
        sourceTurnIds: ["t2"]
      }
    ]
  });

  render(
    <PacChecklist
      checklist={checklist}
      suggestions={[]}
      selectedItemId={null}
      onSelectItem={onSelectItem}
      onApproveSuggestion={vi.fn()}
      onRejectSuggestion={vi.fn()}
      onPublishSuggestions={vi.fn()}
    />
  );

  expect(
    screen.getByText("Synthetic checklist — clinician validation pending")
  ).toBeInTheDocument();
  const medicines = screen.getByRole("button", { name: /medicines/i });
  expect(medicines).toHaveTextContent(/1 gap/i);
  await user.click(medicines);
  await user.click(
    screen.getByRole("button", { name: /current or recent medicines/i })
  );
  expect(onSelectItem).toHaveBeenCalledWith("medications");
});

it("shows unknown-procedure suggestions outside completeness", async () => {
  const checklist = evaluateChecklist({
    procedure: "Unlisted synthetic procedure",
    contextFlags: [],
    transcript: [],
    proposals: []
  });
  render(
    <PacChecklist
      checklist={checklist}
      suggestions={[
        {
          id: "suggestion-run-1-1",
          procedure: "Unlisted synthetic procedure",
          modelRunId: "run-1",
          categoryId: "history",
          question: "Was relevant reported history discussed?",
          rationale: "Procedure documentation review.",
          required: false,
          severity: "standard",
          authority: "evidence_or_clinician",
          deferrable: true,
          approvalState: "pending_clinician_review"
        }
      ]}
      selectedItemId={null}
      onSelectItem={vi.fn()}
      onApproveSuggestion={vi.fn()}
      onRejectSuggestion={vi.fn()}
      onPublishSuggestions={vi.fn()}
    />
  );

  expect(
    screen.getByRole("region", { name: /ai-suggested questions/i })
  ).toHaveTextContent(/excluded from completeness/i);
  expect(screen.getByRole("button", { name: /approve question/i })).toBeVisible();
});
