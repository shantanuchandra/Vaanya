import {
  EncounterSchema,
  withEvaluatedChecklist,
  type Encounter
} from "@vaanaya/contracts";

export function createDemoEncounter(): Encounter {
  return withEvaluatedChecklist(EncounterSchema.parse({
    id: "demo",
    patient: {
      id: "patient-demo-shantanu",
      displayName: "Shantanu Chandra",
      mobileNumber: "+919811110001",
      mobileLast4: "0001"
    },
    patientReference: "Shantanu Chandra",
    procedure: "Laparoscopic hernia repair",
    preferredLanguage: "hi-IN",
    state: "clinician_review",
    consentRecorded: true,
    requiredFieldIds: ["medications", "allergies", "prior_anesthesia"],
    proposals: [
      ...[
        ["identity", "Patient identity", "Identity confirmed by clinician."],
        ["procedure", "Planned procedure", "Procedure confirmed by clinician."],
        ["consent", "Recording consent", "Recording consent documented."],
        ["medical_history", "Relevant medical history", "History reviewed by clinician."],
        ["examination", "Clinician examination", "Examination entered by clinician."],
        ["open_items", "Open items", "Open items reviewed by clinician."],
        ["clinician_conclusion", "Clinician conclusion", "Conclusion entered by clinician."]
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
          "Patient describes a blood-thinning tablet; name unknown; last reported use was yesterday.",
        sourceTurnIds: ["t2"],
        required: true
      },
      {
        id: "allergies",
        label: "Allergies",
        state: "captured",
        value: "No allergy recalled in this synthetic encounter.",
        sourceTurnIds: ["t4"],
        required: true
      },
      {
        id: "previous_anesthesia",
        label: "Previous anesthesia",
        state: "captured",
        value: "Previous procedure reported; no complication recalled.",
        sourceTurnIds: ["t6"],
        required: true
      },
      {
        id: "fasting",
        label: "Fasting and readiness",
        state: "captured",
        value: "Patient reports no intake after the stated evening meal.",
        sourceTurnIds: ["t8"],
        required: false
      }
    ],
    transcript: [
      {
        id: "t1",
        speaker: "clinician",
        language: "en-IN",
        original: "Do you take any regular medicines?",
        translation: "क्या आप कोई नियमित दवा लेते हैं?",
        confidence: 0.99,
        offsetSeconds: 11
      },
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
        id: "t3",
        speaker: "clinician",
        language: "en-IN",
        original: "Do you have the strip or prescription with you?",
        translation: "क्या आपके पास दवा की स्ट्रिप या पर्चा है?",
        confidence: 0.99,
        offsetSeconds: 27
      },
      {
        id: "t4",
        speaker: "patient",
        language: "hi-IN",
        original: "Koi allergy yaad nahi hai.",
        translation: "I do not recall any allergy.",
        confidence: 0.95,
        offsetSeconds: 42
      },
      {
        id: "t6",
        speaker: "patient",
        language: "hi-IN",
        original: "Pehle operation hua tha, anesthesia mein problem yaad nahi.",
        translation:
          "I had an operation before and do not recall a problem with anesthesia.",
        confidence: 0.93,
        offsetSeconds: 58
      },
      {
        id: "t8",
        speaker: "patient",
        language: "hi-IN",
        original: "Raat ke khane ke baad kuch nahi liya.",
        translation: "I had nothing after the evening meal.",
        confidence: 0.94,
        offsetSeconds: 76
      }
    ],
    audit: [
      {
        id: "seed-demo-shantanu",
        action: "synthetic_demo_seeded",
        actorId: "system",
        occurredAt: "2026-07-26T08:30:00.000Z",
        detail: {
          syntheticDemo: true,
          recordedAt: "2026-07-26T08:30:00.000Z",
          pacFocus: "Hypertension medication verification"
        }
      }
    ]
  }));
}
