import {
  EncounterSchema,
  withEvaluatedChecklist,
  type Encounter
} from "@vaanaya/contracts";
import { createDemoEncounter } from "./demo-encounter";

type DemoProfile = {
  id: string;
  name: string;
  mobileNumber: string;
  procedure: string;
  preferredLanguage: "hi-IN" | "en-IN" | "kn-IN";
  recordedAt: string;
  state: Encounter["state"];
  focusLabel: string;
  focusState: "captured" | "uncertain" | "missing";
  focusValue: string;
  pregnancyQuestionApplicable?: boolean;
};

const profiles: DemoProfile[] = [
  {
    id: "synthetic-udayan",
    name: "Udayan Walvekar",
    mobileNumber: "+919811110002",
    procedure: "Knee replacement",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T08:45:00.000Z",
    state: "clinician_review",
    focusLabel: "Diabetes medicines and functional capacity",
    focusState: "missing",
    focusValue:
      "Diabetes medicine timing and stair-climbing tolerance were not discussed."
  },
  {
    id: "synthetic-abhishek",
    name: "Abhishek Patil",
    mobileNumber: "+919811110003",
    procedure: "Upper GI endoscopy",
    preferredLanguage: "hi-IN",
    recordedAt: "2026-07-26T09:00:00.000Z",
    state: "clinician_review",
    focusLabel: "Allergies",
    focusState: "uncertain",
    focusValue: "The allergy response was discussed but remained unclear."
  },
  {
    id: "synthetic-ameeth",
    name: "Ameeth Dubey",
    mobileNumber: "+919811110004",
    procedure: "Transurethral urological procedure",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T09:15:00.000Z",
    state: "recording",
    focusLabel: "Previous anesthesia",
    focusState: "missing",
    focusValue: "Previous-anesthesia history was not discussed."
  },
  {
    id: "synthetic-rajnish",
    name: "Rajnish Kumar",
    mobileNumber: "+919811110005",
    procedure: "Cataract surgery",
    preferredLanguage: "hi-IN",
    recordedAt: "2026-07-26T09:30:00.000Z",
    state: "clinician_review",
    focusLabel: "Blood thinner",
    focusState: "uncertain",
    focusValue: "Blood-thinner name and last dose were not reliably captured."
  },
  {
    id: "synthetic-ananya",
    name: "Ananya Rao",
    mobileNumber: "+919811110006",
    procedure: "Laparoscopic hysterectomy",
    preferredLanguage: "kn-IN",
    recordedAt: "2026-07-26T09:45:00.000Z",
    state: "clinician_review",
    focusLabel: "Bleeding history and anaemia evidence",
    focusState: "captured",
    focusValue:
      "Bleeding history was captured; investigation evidence remains for clinician review."
  },
  {
    id: "synthetic-meera",
    name: "Meera Kulkarni",
    mobileNumber: "+919811110007",
    procedure: "Breast surgery",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T10:00:00.000Z",
    state: "signed",
    focusLabel: "Medicines, allergies, and previous anesthesia",
    focusState: "captured",
    focusValue: "Required history was captured and clinician-confirmed."
  },
  {
    id: "synthetic-kavya",
    name: "Kavya Nair",
    mobileNumber: "+919811110008",
    procedure: "Laparoscopic cholecystectomy",
    preferredLanguage: "kn-IN",
    recordedAt: "2026-07-26T10:15:00.000Z",
    state: "recording",
    focusLabel: "Applicable pregnancy question and recent symptoms",
    focusState: "missing",
    focusValue:
      "Applicable pregnancy question and recent symptoms were not discussed.",
    pregnancyQuestionApplicable: true
  },
  {
    id: "synthetic-priya",
    name: "Priya Deshmukh",
    mobileNumber: "+919811110009",
    procedure: "Knee replacement",
    preferredLanguage: "hi-IN",
    recordedAt: "2026-07-26T10:30:00.000Z",
    state: "processing",
    focusLabel: "Diabetes, functional capacity, and medicines",
    focusState: "uncertain",
    focusValue: "Medication reconciliation is awaiting processing completion."
  },
  {
    id: "synthetic-nandini",
    name: "Nandini Iyer",
    mobileNumber: "+919811110010",
    procedure: "Upper GI endoscopy",
    preferredLanguage: "en-IN",
    recordedAt: "2026-07-26T10:45:00.000Z",
    state: "clinician_review",
    focusLabel: "Fasting discussion and reflux history",
    focusState: "captured",
    focusValue:
      "Fasting discussion and reflux history were captured for clinician review."
  }
];

function encounterFromProfile(profile: DemoProfile): Encounter {
  const isUploaded = profile.state === "recording";
  const turnId = `${profile.id}-focus`;
  const speaker = profile.focusState === "missing" ? "clinician" : "patient";
  const evidenceText =
    profile.focusState === "missing"
      ? `Please describe: ${profile.focusLabel}.`
      : profile.focusValue;

  const focusId =
    /allerg/i.test(profile.focusLabel)
      ? "allergies"
      : /previous anesthesia/i.test(profile.focusLabel)
        ? "previous_anesthesia"
        : /bleeding/i.test(profile.focusLabel)
          ? "bleeding_history"
          : /fasting|reflux/i.test(profile.focusLabel)
            ? "fasting"
            : /medicine|blood thinner|diabetes/i.test(profile.focusLabel)
              ? "medications"
              : "medical_history";

  return withEvaluatedChecklist(EncounterSchema.parse({
    id: profile.id,
    patient: {
      id: `patient-${profile.id}`,
      displayName: profile.name,
      mobileNumber: profile.mobileNumber,
      mobileLast4: profile.mobileNumber.slice(-4)
    },
    patientReference: profile.name,
    procedure: profile.procedure,
    preferredLanguage: profile.preferredLanguage,
    state: profile.state,
    consentRecorded: true,
    sourceType: "uploaded_mp4",
    checklistContext: {
      templateId: "synthetic-pac",
      version: "synthetic-pac-v1",
      contextFlags:
        profile.pregnancyQuestionApplicable === true
          ? ["pregnancy_question_applicable"]
          : []
    },
    requiredFieldIds: isUploaded ? [] : [focusId],
    proposals: isUploaded
      ? []
      : [
          {
            id: focusId,
            label: profile.focusLabel,
            state: profile.focusState,
            value: profile.focusValue,
            sourceTurnIds: [turnId],
            required: true
          }
        ],
    transcript: isUploaded
      ? []
      : [
          {
            id: turnId,
            speaker,
            language: profile.preferredLanguage,
            original: evidenceText,
            translation: evidenceText,
            confidence: profile.focusState === "uncertain" ? 0.72 : 0.95,
            offsetSeconds: 12
          }
        ],
    audit: [
      {
        id: `seed-${profile.id}`,
        action: "synthetic_demo_seeded",
        actorId: "system",
        occurredAt: profile.recordedAt,
        detail: {
          syntheticDemo: true,
          recordedAt: profile.recordedAt,
          pacFocus: profile.focusLabel,
          pregnancyQuestionApplicable:
            profile.pregnancyQuestionApplicable ?? false
        }
      }
    ]
  }));
}

export function createDemoEncounters(): Encounter[] {
  return [createDemoEncounter(), ...profiles.map(encounterFromProfile)];
}
