import { describe, expect, it } from "vitest";
import {
  canTransition,
  deferChecklistItem,
  EncounterSchema,
  enterChecklistItem,
  FieldProposalSchema,
  RecordingListSchema,
  resolveProposal,
  signEncounter,
  withEvaluatedChecklist
} from "./index";

const encounter = EncounterSchema.parse({
  id: "demo-encounter",
  patientReference: "SYN-PAC-042",
  procedure: "Elective abdominal procedure",
  preferredLanguage: "hi-IN",
  state: "clinician_review",
  consentRecorded: true,
  requiredFieldIds: ["medications", "allergies"],
  proposals: [
    ...[
      ["identity", "Patient identity", "Identity confirmed"],
      ["procedure", "Planned procedure", "Procedure confirmed"],
      ["consent", "Recording consent", "Consent recorded"],
      ["medical_history", "Relevant medical history", "History reviewed"],
      ["previous_anesthesia", "Previous anesthesia", "History reviewed"],
      ["fasting", "Reported fasting intake and time", "Statement reviewed"],
      ["examination", "Clinician examination", "Examination entered"],
      ["open_items", "Open items", "Open items reviewed"],
      ["clinician_conclusion", "Clinician conclusion", "Conclusion entered"]
    ].map(([id, label, value]) => ({
      id,
      label,
      state: "clinician_entered" as const,
      value,
      sourceTurnIds: [],
      required: true
    })),
    {
      id: "medications",
      label: "Current medicines",
      state: "uncertain",
      value:
        "Patient describes a blood-thinning tablet; name unknown; last use yesterday.",
      sourceTurnIds: ["t2"],
      required: true
    },
    {
      id: "allergies",
      label: "Allergies",
      state: "captured",
      value: "No allergy reported in this synthetic encounter.",
      sourceTurnIds: ["t4"],
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
    },
    {
      id: "t4",
      speaker: "patient",
      language: "hi-IN",
      original: "Koi allergy yaad nahi hai.",
      translation: "I do not recall any allergy.",
      confidence: 0.95,
      offsetSeconds: 42
    }
  ],
  audit: []
});

describe("workflow transitions", () => {
  it("preserves grounded evidence phrases and recording metadata", () => {
    const parsed = EncounterSchema.parse({
      ...encounter,
      recordings: [
        {
          id: "recording-1",
          sourceType: "uploaded_mp4",
          durationSeconds: 76,
          recordedAt: "2026-07-26T09:14:01.000Z"
        }
      ],
      transcript: [
        {
          id: "turn-1",
          speaker: "patient",
          language: "en-IN",
          original: "I took the blood thinner yesterday.",
          translation: "I took the blood thinner yesterday.",
          evidencePhrases: ["blood thinner", "yesterday"],
          confidence: 0.95,
          offsetSeconds: 4
        }
      ]
    });

    expect(parsed.recordings).toEqual([
      {
        id: "recording-1",
        sourceType: "uploaded_mp4",
        durationSeconds: 76,
        recordedAt: "2026-07-26T09:14:01.000Z"
      }
    ]);
    expect(parsed.transcript[0]?.evidencePhrases).toEqual([
      "blood thinner",
      "yesterday"
    ]);
    expect(EncounterSchema.parse(encounter).recordings).toEqual([]);
  });

  it("allows clinician-entered content without manufactured transcript evidence", () => {
    expect(() =>
      FieldProposalSchema.parse({
        id: "examination",
        label: "Examination",
        state: "clinician_entered",
        value: "Clinician documented examination",
        sourceTurnIds: [],
        required: true
      })
    ).not.toThrow();
  });

  it("rejects captured content without source evidence", () => {
    expect(() =>
      FieldProposalSchema.parse({
        id: "medications",
        label: "Medicines",
        state: "captured",
        value: "Tablet",
        sourceTurnIds: [],
        required: true
      })
    ).toThrow();
  });

  it("creates a clinician-only entry and recomputes readiness", () => {
    const withoutExamination = EncounterSchema.parse({
      ...encounter,
      proposals: encounter.proposals.filter(item => item.id !== "examination")
    });
    const updated = enterChecklistItem(withoutExamination, {
      itemId: "examination",
      value: "Clinician-entered examination",
      actorId: "clinician-1"
    });

    expect(updated.proposals).toContainEqual(
      expect.objectContaining({
        id: "examination",
        state: "clinician_entered",
        sourceTurnIds: []
      })
    );
    expect(updated.audit.at(-1)?.action).toBe("checklist.item_entered");
  });

  it("allows clinician entry for an approved procedure-library item", () => {
    const extended = EncounterSchema.parse({
      ...encounter,
      checklistExtensions: [
        {
          id: "library-airway-history",
          categoryId: "history",
          label: "Procedure-specific airway history",
          question: "Was the reported airway history discussed?",
          rationale: "Clinician-approved procedure documentation question.",
          required: false,
          authority: "evidence_or_clinician",
          severity: "standard",
          deferrable: true,
          applicability: { kind: "always" }
        }
      ]
    });

    const updated = enterChecklistItem(extended, {
      itemId: "library-airway-history",
      value: "Clinician reviewed and documented the reported history.",
      actorId: "clinician-1"
    });

    expect(
      updated.checklist?.items.find(item => item.id === "library-airway-history")
    ).toMatchObject({
      status: "answered",
      value: "Clinician reviewed and documented the reported history."
    });
  });

  it("rejects deferral of the clinician conclusion", () => {
    expect(() =>
      deferChecklistItem(encounter, {
        itemId: "clinician_conclusion",
        reason: "Not completed",
        actorId: "clinician-1"
      })
    ).toThrow(/cannot be deferred/i);
  });

  it("attaches the versioned checklist evaluation", () => {
    expect(withEvaluatedChecklist(encounter).checklist).toMatchObject({
      templateId: "synthetic-pac",
      version: "synthetic-pac-v1",
      readyForSignoff: false
    });
  });

  it("validates an evidence-backed synthetic recording list item", () => {
    expect(
      RecordingListSchema.parse([
        {
          encounterId: "synthetic-shantanu",
          patient: {
            id: "patient-shantanu",
            displayName: "Shantanu Chandra",
            mobileNumber: "+919811110001",
            mobileLast4: "0001"
          },
          synthetic: true,
          procedure: "Laparoscopic hernia repair",
          preferredLanguage: "hi-IN",
          recordedAt: "2026-07-26T08:30:00.000Z",
          status: "uploaded",
          answeredCount: 2,
          applicableCount: 4,
          criticalGapCount: 1,
          hasTranscript: false
        }
      ])
    ).toHaveLength(1);
  });

  it("rejects signing while a required field is uncertain", () => {
    expect(() =>
      signEncounter(encounter, {
        actorId: "clinician-1",
        actorRole: "clinician"
      })
    ).toThrow(/required fields/i);
  });

  it("rejects signing by a coordinator", () => {
    const resolved = resolveProposal(encounter, {
      proposalId: "medications",
      value: "Exact medicine recorded from strip and awaiting clinical interpretation.",
      actorId: "clinician-1"
    });

    expect(() =>
      signEncounter(resolved, {
        actorId: "coordinator-1",
        actorRole: "coordinator"
      })
    ).toThrow(/clinician/i);
  });

  it("signs after clinician resolution and appends audit evidence", () => {
    const resolved = resolveProposal(encounter, {
      proposalId: "medications",
      value: "Exact medicine recorded from strip and confirmed by clinician.",
      actorId: "clinician-1"
    });
    const signed = signEncounter(resolved, {
      actorId: "clinician-1",
      actorRole: "clinician"
    });

    expect(signed.state).toBe("signed");
    expect(signed.audit.at(-1)).toMatchObject({
      action: "encounter.signed",
      actorId: "clinician-1",
      detail: {
        checklistTemplateId: "synthetic-pac",
        checklistVersion: "synthetic-pac-v1"
      }
    });
  });

  it("does not permit skipping consent before recording", () => {
    expect(canTransition("created", "recording")).toBe(false);
    expect(canTransition("created", "consented")).toBe(true);
  });
});
