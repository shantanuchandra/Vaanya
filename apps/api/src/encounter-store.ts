import type {
  Encounter,
  ChecklistLibraryVersion,
  PatientSummary,
  RecordingListItem,
  RecordingStatus
} from "@vaanaya/contracts";
import {
  EncounterSchema,
  withEvaluatedChecklist
} from "@vaanaya/contracts";

type CreatePatientInput = {
  organizationId: string;
  actorId: string;
  displayName: string;
  mobileNumber: string;
};

type CreateEncounterInput = {
  organizationId: string;
  actorId: string;
  patientId: string;
  procedure: string;
  preferredLanguage: string;
  sourceType: "live" | "uploaded_mp4";
};

export interface EncounterStore {
  get(id: string): Promise<Encounter | null>;
  save(encounter: Encounter): Promise<Encounter>;
  searchPatients(input: {
    organizationId: string;
    query: string;
  }): Promise<PatientSummary[]>;
  createPatient(input: CreatePatientInput): Promise<PatientSummary>;
  createEncounter(input: CreateEncounterInput): Promise<Encounter>;
  listRecordings(input: {
    organizationId: string;
  }): Promise<RecordingListItem[]>;
  findChecklistLibraryVersion(input: {
    organizationId: string;
    normalizedProcedure: string;
  }): Promise<ChecklistLibraryVersion | null>;
  publishChecklistLibraryVersion(
    version: ChecklistLibraryVersion
  ): Promise<ChecklistLibraryVersion>;
}

function recordingStatus(encounter: Encounter): RecordingStatus {
  if (
    encounter.audit.some(
      event => event.action === "recording.processing_failed"
    )
  )
    return "failed";
  if (
    ["signed", "summary_approved", "shared"].includes(encounter.state)
  )
    return "signed";
  if (encounter.state === "processing") return "processing";
  if (encounter.state === "clinician_review") return "ready_for_review";
  return "uploaded";
}

export function recordingListItem(encounter: Encounter): RecordingListItem {
  if (!encounter.patient)
    throw new Error("A recording list item requires a patient.");
  const checklist =
    encounter.checklist ?? withEvaluatedChecklist(encounter).checklist!;
  const recordedAt =
    encounter.audit
      .map(event => event.detail.recordedAt)
      .find((value): value is string => typeof value === "string") ??
    encounter.audit[0]?.occurredAt ??
    "2026-07-26T00:00:00.000Z";
  const applicableCount = checklist.applicableCount;
  const status = recordingStatus(encounter);
  return {
    encounterId: encounter.id,
    patient: encounter.patient,
    synthetic: true,
    procedure: encounter.procedure,
    preferredLanguage: encounter.preferredLanguage,
    recordedAt,
    status,
    answeredCount: checklist.answeredCount,
    applicableCount,
    criticalGapCount: checklist.blockingGapCount,
    hasTranscript: encounter.transcript.length > 0,
    secondOpinionRequested: encounter.secondOpinionRequested,
    checklistLibrary: encounter.checklistLibrary
  };
}

export function sortRecordingList(
  items: RecordingListItem[]
): RecordingListItem[] {
  return [...items].sort((left, right) => {
    const priority =
      Number(left.status !== "uploaded") - Number(right.status !== "uploaded");
    return priority || Date.parse(right.recordedAt) - Date.parse(left.recordedAt);
  });
}

export class MemoryEncounterStore implements EncounterStore {
  readonly #encounters = new Map<string, Encounter>();
  readonly #patients = new Map<
    string,
    PatientSummary & { organizationId: string; normalizedLookup: string }
  >();
  readonly #checklistLibrary = new Map<string, ChecklistLibraryVersion[]>();

  constructor(initial: Encounter[]) {
    for (const encounter of initial) {
      this.#encounters.set(encounter.id, encounter);
      if (encounter.patient) {
        this.#patients.set(encounter.patient.id, {
          ...encounter.patient,
          organizationId: "org-1",
          normalizedLookup: normalizePatientLookup(
            encounter.patient.displayName,
            encounter.patient.mobileNumber
          )
        });
      }
    }
  }

  async get(id: string): Promise<Encounter | null> {
    return this.#encounters.get(id) ?? null;
  }

  async save(encounter: Encounter): Promise<Encounter> {
    this.#encounters.set(encounter.id, encounter);
    return encounter;
  }

  async searchPatients(input: {
    organizationId: string;
    query: string;
  }): Promise<PatientSummary[]> {
    const query = input.query.trim().toLowerCase();
    return [...this.#patients.values()]
      .filter(patient => patient.organizationId === input.organizationId)
      .filter(patient =>
        query
          ? patient.displayName.toLowerCase().includes(query) ||
            patient.mobileNumber.includes(query)
          : true
      )
      .map(({ organizationId: _organizationId, normalizedLookup: _lookup, ...patient }) => patient);
  }

  async createPatient(input: CreatePatientInput): Promise<PatientSummary> {
    const normalizedLookup = normalizePatientLookup(
      input.displayName,
      input.mobileNumber
    );
    const existing = [...this.#patients.values()].find(
      patient =>
        patient.organizationId === input.organizationId &&
        patient.normalizedLookup === normalizedLookup
    );
    if (existing) {
      const {
        organizationId: _organizationId,
        normalizedLookup: _lookup,
        ...patient
      } = existing;
      return patient;
    }

    const patient: PatientSummary & {
      organizationId: string;
      normalizedLookup: string;
    } = {
      id: `patient-${crypto.randomUUID()}`,
      displayName: input.displayName.trim(),
      mobileNumber: input.mobileNumber.trim(),
      mobileLast4: normalizedMobile(input.mobileNumber).slice(-4).padStart(4, "0"),
      organizationId: input.organizationId,
      normalizedLookup
    };
    this.#patients.set(patient.id, patient);
    return {
      id: patient.id,
      displayName: patient.displayName,
      mobileNumber: patient.mobileNumber,
      mobileLast4: patient.mobileLast4
    };
  }

  async createEncounter(input: CreateEncounterInput): Promise<Encounter> {
    const patient = this.#patients.get(input.patientId);
    if (!patient || patient.organizationId !== input.organizationId) {
      throw new Error("Unknown patient.");
    }

    const encounter = withEvaluatedChecklist(EncounterSchema.parse({
      id: `enc-${crypto.randomUUID()}`,
      patient: {
        id: patient.id,
        displayName: patient.displayName,
        mobileNumber: patient.mobileNumber,
        mobileLast4: patient.mobileLast4
      },
      patientReference: patient.displayName,
      procedure: input.procedure.trim(),
      preferredLanguage: input.preferredLanguage,
      state: "recording",
      consentRecorded: true,
      sourceType: input.sourceType,
      recommendationQuestions: [],
      requiredFieldIds: ["medications"],
      proposals: [],
      transcript: [],
      audit: [
        {
          id: crypto.randomUUID(),
          action: "encounter.created",
          actorId: input.actorId,
          occurredAt: new Date().toISOString(),
          detail: {
            patientId: patient.id,
            sourceType: input.sourceType,
            respondentType: "patient"
          }
        }
      ]
    }));
    this.#encounters.set(encounter.id, encounter);
    return encounter;
  }

  async listRecordings(input: {
    organizationId: string;
  }): Promise<RecordingListItem[]> {
    void input.organizationId;
    return sortRecordingList(
      [...this.#encounters.values()].map(recordingListItem)
    );
  }

  async findChecklistLibraryVersion(input: {
    organizationId: string;
    normalizedProcedure: string;
  }): Promise<ChecklistLibraryVersion | null> {
    return (
      this.#checklistLibrary
        .get(`${input.organizationId}:${input.normalizedProcedure}`)
        ?.at(-1) ?? null
    );
  }

  async publishChecklistLibraryVersion(
    version: ChecklistLibraryVersion
  ): Promise<ChecklistLibraryVersion> {
    const key = `${version.organizationId}:${version.normalizedProcedure}`;
    const versions = this.#checklistLibrary.get(key) ?? [];
    if (versions.some(current => current.version === version.version))
      throw new Error("Checklist library version already exists.");
    this.#checklistLibrary.set(key, [...versions, version]);
    return version;
  }
}

function normalizedMobile(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizePatientLookup(name: string, mobileNumber: string): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, " ")}:${normalizedMobile(
    mobileNumber
  )}`;
}
