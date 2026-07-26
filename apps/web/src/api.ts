import {
  EncounterSchema,
  PatientSummarySchema,
  RecordingListSchema,
  type Encounter,
  type PatientSummary,
  type RecordingListItem
} from "@vaanaya/contracts";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
type AccessTokenProvider = () => Promise<string | null>;
let accessTokenProvider: AccessTokenProvider = async () => null;

export function setAccessTokenProvider(provider: AccessTokenProvider) {
  accessTokenProvider = provider;
}

async function authHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra);
  const token = await accessTokenProvider();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

async function protectedFetch(input: string, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: await authHeaders(init.headers)
  });
}

export type TranscriptionResult = {
  requestId: string | null;
  transcript: string;
  languageCode: string | null;
  languageProbability: number | null;
};

export async function searchPatients(query: string): Promise<PatientSummary[]> {
  const response = await protectedFetch(
    `${API_BASE}/api/patients?q=${encodeURIComponent(query)}`
  );
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Patients could not be loaded.");
  if (!Array.isArray(payload)) return [];
  return payload.map(item => PatientSummarySchema.parse(item));
}

export async function getRecordings(): Promise<RecordingListItem[]> {
  const response = await protectedFetch(`${API_BASE}/api/recordings`);
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Recordings could not be loaded.");
  return RecordingListSchema.parse(payload);
}

export async function createPatient(input: {
  displayName: string;
  mobileNumber: string;
}): Promise<PatientSummary> {
  const response = await protectedFetch(`${API_BASE}/api/patients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Patient could not be created.");
  return PatientSummarySchema.parse(payload);
}

export async function createEncounterRequest(input: {
  patientId: string;
  procedure: string;
  preferredLanguage: string;
  sourceType: "live" | "uploaded_mp4";
}): Promise<Encounter> {
  const response = await protectedFetch(`${API_BASE}/api/encounters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Encounter could not be created.");
  return EncounterSchema.parse(payload);
}

export async function processMockRecording(
  encounterId: string,
  input: {
    sourceType: "live" | "uploaded_mp4";
    transcript: string;
    procedure?: string;
  }
): Promise<Encounter> {
  const response = await protectedFetch(
    `${API_BASE}/api/encounters/${encounterId}/mock-recording`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Recording could not populate the PAC.");
  return EncounterSchema.parse(payload);
}

export async function requestSecondOpinion(
  encounterId: string
): Promise<Encounter> {
  const response = await protectedFetch(
    `${API_BASE}/api/encounters/${encounterId}/second-opinion`,
    {
      method: "POST",
      headers: { "content-type": "application/json" }
    }
  );
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Second opinion could not be requested.");
  return EncounterSchema.parse(payload);
}

export async function transcribeAudio(
  audio: Blob,
  languageCode: "unknown" | "hi-IN" | "kn-IN" | "en-IN" = "unknown"
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.set("file", audio, `patient-${Date.now()}.webm`);
  const response = await protectedFetch(
    `${API_BASE}/api/speech/transcribe?languageCode=${languageCode}`,
    { method: "POST", body: form }
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Speech could not be transcribed.";
    throw new Error(message);
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("transcript" in payload) ||
    typeof payload.transcript !== "string"
  ) {
    throw new Error("The transcription response was invalid.");
  }
  return {
    requestId:
      "requestId" in payload && typeof payload.requestId === "string"
        ? payload.requestId
        : null,
    transcript: payload.transcript,
    languageCode:
      "languageCode" in payload && typeof payload.languageCode === "string"
        ? payload.languageCode
        : null,
    languageProbability:
      "languageProbability" in payload &&
      typeof payload.languageProbability === "number"
        ? payload.languageProbability
        : null
  };
}

export async function transcribeEncounterSpeech(
  encounterId: string,
  audio: Blob,
  languageCode: "unknown" | "hi-IN" | "kn-IN" | "en-IN" = "unknown"
): Promise<{
  transcription: TranscriptionResult;
  suggestions: Array<{
    field: string;
    state: "captured" | "uncertain" | "missing";
    value: string;
    sourceTurnIds: string[];
  }>;
  encounter: Encounter;
}> {
  const form = new FormData();
  form.set("file", audio, `patient-${Date.now()}.webm`);
  const response = await protectedFetch(
    `${API_BASE}/api/encounters/${encounterId}/speech?languageCode=${languageCode}`,
    { method: "POST", body: form }
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.message ?? "Speech could not be converted into review suggestions."
    );
  return {
    transcription: payload.transcription,
    suggestions: payload.suggestions,
    encounter: EncounterSchema.parse(payload.encounter)
  };
}

export async function transcribeExampleRecording(
  encounterId: string,
  languageCode: "unknown" | "hi-IN" | "kn-IN" | "en-IN" = "hi-IN"
): Promise<{
  transcription: TranscriptionResult;
  suggestions: Array<{
    field: string;
    state: "captured" | "uncertain" | "missing";
    value: string;
    sourceTurnIds: string[];
  }>;
  encounter: Encounter;
}> {
  const response = await protectedFetch(
    `${API_BASE}/api/encounters/${encounterId}/example-recording?languageCode=${languageCode}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" }
    }
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.message ?? "Example recording could not be converted into evidence."
    );
  return {
    transcription: payload.transcription,
    suggestions: payload.suggestions,
    encounter: EncounterSchema.parse(payload.encounter)
  };
}

export async function processCompleteExampleRecording(
  encounterId: string
): Promise<{
  status: "completed";
  encounter: Encounter;
}> {
  const response = await protectedFetch(
    `${API_BASE}/api/encounters/${encounterId}/complete-example-recording`,
    {
      method: "POST"
    }
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.message ??
        "Complete synthetic recording could not be converted into evidence."
    );
  return {
    status: "completed",
    encounter: EncounterSchema.parse(payload.encounter)
  };
}

export async function getEncounter(id: string): Promise<Encounter> {
  const response = await protectedFetch(`${API_BASE}/api/encounters/${id}`);
  if (!response.ok) throw new Error("The encounter could not be loaded.");
  return EncounterSchema.parse(await response.json());
}

export async function resolveField(
  encounterId: string,
  proposalId: string,
  value: string
): Promise<Encounter> {
  const response = await protectedFetch(
    `${API_BASE}/api/encounters/${encounterId}/proposals/${proposalId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value })
    }
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "The field could not be resolved.";
    throw new Error(message);
  }
  return EncounterSchema.parse(payload);
}

export async function signEncounterRequest(
  encounterId: string
): Promise<Encounter> {
  const response = await protectedFetch(`${API_BASE}/api/encounters/${encounterId}/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actorId: "demo-clinician",
      actorRole: "clinician"
    })
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "The note could not be signed.";
    throw new Error(message);
  }
  return EncounterSchema.parse(payload);
}

export type KannadaHandoff = {
  sourceText: string;
  translatedText: string;
  languageCode: "kn-IN";
  audioBase64: string;
  audioMimeType: "audio/mpeg";
};

export type GoldenCaseReview = {
  caseId: string;
  verdict: "approved" | "needs_revision" | "unsafe";
  notes: string;
  confidence: number;
  reviewerId: string;
  reviewedAt: string;
};

export type GoldenCase = {
  caseId: string;
  title: string;
  language: { path: string; primary: string; codeMixed: boolean };
  difficulty: string;
  conversation: Array<{
    turnId: string;
    speaker: string;
    language: string;
    text: string;
    confidence: number;
  }>;
  expectedPac: Record<
    string,
    { state: string; value: string; sourceTurnIds: string[] }
  >;
  requiredClarifications: Array<{ intent: string; prompt: string }>;
  prohibitedInferences: string[];
  review: GoldenCaseReview | null;
};

export async function getGoldenCases(): Promise<{
  cases: GoldenCase[];
  completed: number;
  total: number;
}> {
  const response = await protectedFetch(`${API_BASE}/api/reviews/golden-cases`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "Review queue unavailable.");
  return payload;
}

export async function saveGoldenCaseReview(
  caseId: string,
  input: {
    verdict: GoldenCaseReview["verdict"];
    notes: string;
    confidence: number;
  }
): Promise<GoldenCaseReview> {
  const response = await protectedFetch(
    `${API_BASE}/api/reviews/golden-cases/${caseId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "Review could not be saved.");
  return payload;
}

export type TimingObservation = {
  scenarioId: string;
  paperSeconds: number;
  vaanayaSeconds: number;
  paperCorrections: number;
  vaanayaCorrections: number;
  notes: string;
  observedBy: string;
  observedAt: string;
};

export type TimingSummary = {
  pairedObservations: number;
  medianPaperSeconds: number;
  medianVaanayaSeconds: number;
  medianReductionPercent: number;
};

export async function getTimingEvidence(): Promise<{
  observations: TimingObservation[];
  summary: TimingSummary | null;
}> {
  const response = await protectedFetch(`${API_BASE}/api/evidence/timing`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "Timing evidence unavailable.");
  return payload;
}

export async function saveTimingObservation(
  observation: Omit<TimingObservation, "observedBy" | "observedAt">
) {
  const response = await protectedFetch(
    `${API_BASE}/api/evidence/timing/${observation.scenarioId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(observation)
    }
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "Timing could not be saved.");
  return payload as TimingObservation;
}

export async function createKannadaHandoff(
  encounterId: string
): Promise<KannadaHandoff> {
  const response = await protectedFetch(
    `${API_BASE}/api/encounters/${encounterId}/kannada-handoff`,
    { method: "POST" }
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Kannada handoff could not be generated.";
    throw new Error(message);
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("translatedText" in payload) ||
    typeof payload.translatedText !== "string" ||
    !("audioBase64" in payload) ||
    typeof payload.audioBase64 !== "string"
  ) {
    throw new Error("The Kannada handoff response was invalid.");
  }
  return payload as KannadaHandoff;
}
