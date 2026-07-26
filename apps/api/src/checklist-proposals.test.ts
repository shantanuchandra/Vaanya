import { describe, expect, it } from "vitest";
import { materializeChecklistProposals } from "./checklist-proposals";

describe("checklist proposal materialization", () => {
  it("drops unknown model IDs and downgrades invalid evidence to missing", () => {
    expect(
      materializeChecklistProposals({
        applicableItems: [
          {
            id: "medications",
            label: "Current or recent medicines",
            required: true,
            authority: "evidence_or_clinician"
          }
        ],
        modelItems: [
          {
            itemId: "diagnosis",
            state: "captured",
            value: "ASA II",
            sourceTurnIds: ["t1"]
          },
          {
            itemId: "medications",
            state: "captured",
            value: "Tablet",
            sourceTurnIds: ["bad"]
          }
        ],
        transcript: [{ id: "t1" }]
      })
    ).toEqual([
      {
        id: "medications",
        label: "Current or recent medicines",
        required: true,
        state: "missing",
        value: "No source-linked answer was captured.",
        sourceTurnIds: []
      }
    ]);
  });

  it("materializes every applicable evidence item and excludes clinician-only items", () => {
    expect(
      materializeChecklistProposals({
        applicableItems: [
          {
            id: "allergies",
            label: "Allergy history",
            required: true,
            authority: "evidence_or_clinician"
          },
          {
            id: "examination",
            label: "Clinician examination",
            required: true,
            authority: "clinician_only"
          }
        ],
        modelItems: [],
        transcript: []
      })
    ).toEqual([
      expect.objectContaining({
        id: "allergies",
        state: "missing",
        sourceTurnIds: []
      })
    ]);
  });
});
