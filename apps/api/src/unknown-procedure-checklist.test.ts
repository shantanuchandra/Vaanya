import { describe, expect, it } from "vitest";
import {
  buildPublishedChecklistVersion,
  decideChecklistSuggestion,
  sanitizeUnknownProcedureSuggestions
} from "./unknown-procedure-checklist";

describe("unknown-procedure checklist suggestions", () => {
  it("keeps at most five safe suggestions pending and non-blocking", () => {
    const suggestions = sanitizeUnknownProcedureSuggestions({
      procedure: "Unlisted synthetic procedure",
      modelRunId: "run-1",
      categoryIds: ["history"],
      suggestions: Array.from({ length: 7 }, (_, index) => ({
        categoryId: "history",
        question: `Was reported history item ${index + 1} discussed?`,
        rationale: "Procedure documentation review."
      }))
    });

    expect(suggestions).toHaveLength(5);
    expect(suggestions[0]).toMatchObject({
      required: false,
      severity: "standard",
      approvalState: "pending_clinician_review"
    });
  });

  it.each(["Assign ASA grade", "Order an ECG", "Stop blood thinner"])(
    "rejects prohibited suggestion %s",
    question => {
      expect(
        sanitizeUnknownProcedureSuggestions({
          procedure: "Unlisted synthetic procedure",
          modelRunId: "run-1",
          categoryIds: ["history"],
          suggestions: [
            {
              categoryId: "history",
              question,
              rationale: "Model suggestion"
            }
          ]
        })
      ).toEqual([]);
    }
  );

  it("rejects categories outside the seeded checklist library", () => {
    expect(
      sanitizeUnknownProcedureSuggestions({
        procedure: "Unlisted synthetic procedure",
        modelRunId: "run-1",
        categoryIds: ["history"],
        suggestions: [
          {
            categoryId: "new-clinical-protocol",
            question: "Was reported history discussed?",
            rationale: "Model suggestion"
          }
        ]
      })
    ).toEqual([]);
  });

  it("requires every suggestion decision before publishing an immutable version", () => {
    const suggestions = sanitizeUnknownProcedureSuggestions({
      procedure: "Unlisted synthetic procedure",
      modelRunId: "run-1",
      categoryIds: ["history"],
      suggestions: [
        {
          categoryId: "history",
          question: "Was reported history discussed?",
          rationale: "Procedure documentation review."
        }
      ]
    });

    expect(() =>
      buildPublishedChecklistVersion({
        organizationId: "org-1",
        procedure: "Unlisted synthetic procedure",
        suggestions,
        latestVersion: 0,
        actorId: "clinician-1"
      })
    ).toThrow(/pending/i);

    const approved = decideChecklistSuggestion({
      suggestions,
      suggestionId: suggestions[0]!.id,
      decision: "approved",
      actorId: "clinician-1"
    });
    expect(
      buildPublishedChecklistVersion({
        organizationId: "org-1",
        procedure: "Unlisted synthetic procedure",
        suggestions: approved,
        latestVersion: 0,
        actorId: "clinician-1"
      })
    ).toMatchObject({
      organizationId: "org-1",
      normalizedProcedure: "unlisted synthetic procedure",
      version: 1,
      source: "clinician_reviewed_synthetic",
      items: [expect.objectContaining({ required: false })]
    });
  });
});
