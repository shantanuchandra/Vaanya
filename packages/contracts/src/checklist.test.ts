import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_PAC_TEMPLATE,
  checklistBlockers,
  evaluateChecklist,
  normalizeProcedureFamily
} from "./checklist";

describe("procedure-aware PAC checklist", () => {
  it.each([
    ["Laparoscopic hernia repair", "laparoscopic_abdominal"],
    ["Laparoscopic hysterectomy", "hysterectomy"],
    ["Knee replacement", "knee_replacement"],
    ["Upper GI endoscopy", "upper_gi_endoscopy"],
    ["Transurethral urological procedure", "urological"],
    ["Cataract surgery", "cataract"],
    ["Breast surgery", "breast"],
    ["Unlisted procedure", "generic"]
  ])("normalizes %s to %s", (procedure, expected) => {
    expect(normalizeProcedureFamily(procedure)).toBe(expected);
  });

  it("does not encode demographic applicability", () => {
    expect(JSON.stringify(SYNTHETIC_PAC_TEMPLATE)).not.toMatch(
      /gender|patient_name|female|male/i
    );
  });

  it("does not activate pregnancy documentation without explicit clinician context", () => {
    const result = evaluateChecklist({
      procedure: "Laparoscopic hysterectomy",
      contextFlags: [],
      proposals: [],
      transcript: []
    });

    expect(
      result.items.find(item => item.id === "pregnancy_context")?.status
    ).toBe("not_applicable");
  });

  it("activates pregnancy documentation only with explicit clinician context", () => {
    const result = evaluateChecklist({
      procedure: "Laparoscopic hysterectomy",
      contextFlags: ["pregnancy_question_applicable"],
      proposals: [],
      transcript: []
    });

    expect(
      result.items.find(item => item.id === "pregnancy_context")?.status
    ).toBe("missing");
  });

  it("does not count a captured proposal with an invalid source as answered", () => {
    const result = evaluateChecklist({
      procedure: "Cataract surgery",
      contextFlags: [],
      proposals: [
        {
          id: "medications",
          state: "captured",
          value: "Tablet reported",
          sourceTurnIds: ["missing-turn"]
        }
      ],
      transcript: [{ id: "t1" }]
    });

    expect(
      result.items.find(item => item.id === "medications")?.status
    ).toBe("uncertain");
  });

  it("counts only required unresolved items as sign blockers", () => {
    const result = evaluateChecklist({
      procedure: "Unlisted procedure",
      contextFlags: [],
      proposals: [
        {
          id: "identity",
          state: "clinician_entered",
          value: "Confirmed",
          sourceTurnIds: []
        },
        {
          id: "procedure",
          state: "clinician_entered",
          value: "Confirmed",
          sourceTurnIds: []
        },
        {
          id: "consent",
          state: "clinician_entered",
          value: "Recorded",
          sourceTurnIds: []
        }
      ],
      transcript: []
    });

    expect(checklistBlockers(result).every(item => item.required)).toBe(true);
    expect(result.applicableCount).toBeGreaterThan(result.answeredCount);
    expect(result.readyForSignoff).toBe(false);
  });

  it("evaluates approved organization-library items as optional extensions", () => {
    const result = evaluateChecklist({
      procedure: "Unlisted procedure",
      contextFlags: [],
      proposals: [],
      transcript: [],
      additionalItems: [
        {
          id: "suggestion-run-1-1",
          categoryId: "history",
          label: "Reported procedure-specific history",
          question: "Was reported procedure-specific history discussed?",
          rationale: "Clinician-approved synthetic library extension.",
          required: false,
          authority: "evidence_or_clinician",
          severity: "standard",
          deferrable: true,
          applicability: { kind: "always" }
        }
      ]
    });

    expect(
      result.items.find(item => item.id === "suggestion-run-1-1")
    ).toMatchObject({
      status: "missing",
      required: false,
      applicable: true
    });
    expect(checklistBlockers(result).map(item => item.id)).not.toContain(
      "suggestion-run-1-1"
    );
  });
});
