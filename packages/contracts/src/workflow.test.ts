import { describe, expect, it } from "vitest";
import {
  canTransition,
  EncounterSchema,
  RecordingListSchema,
  resolveProposal,
  signEncounter
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
      actorId: "clinician-1"
    });
  });

  it("does not permit skipping consent before recording", () => {
    expect(canTransition("created", "recording")).toBe(false);
    expect(canTransition("created", "consented")).toBe(true);
  });
});
