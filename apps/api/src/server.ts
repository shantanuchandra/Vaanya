import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deferChecklistItem,
  enterChecklistItem,
  normalizeProcedureFamily,
  resolveProposal,
  signEncounter,
  SYNTHETIC_PAC_TEMPLATE,
  withEvaluatedChecklist,
  type Encounter,
  type RecommendationQuestion,
  type TranscriptTurn
} from "@vaanaya/contracts";
import { materializeChecklistProposals } from "./checklist-proposals";
import {
  buildPublishedChecklistVersion,
  decideChecklistSuggestion,
  normalizeProcedureLibraryKey,
  sanitizeUnknownProcedureSuggestions
} from "./unknown-procedure-checklist";
import { createDemoEncounters } from "./demo-cohort";
import {
  MemoryEncounterStore,
  type EncounterStore
} from "./encounter-store";
import {
  OpenAiPacClient,
  type PacConversationStructure,
  type PacConversationTurn
} from "./openai-client";
import {
  SarvamClient,
  type DiarizedSegment,
  type SarvamLanguageCode,
  type PacSuggestion,
  type TranscriptionInput,
  type TranscriptionResult
} from "./sarvam-client";
import { SupabaseEncounterStore } from "./supabase-encounter-store";
import { TelegramClient } from "./telegram-client";
import {
  bearerToken,
  SupabaseAuthenticator,
  type AuthenticatedActor,
  type Authenticator
} from "./auth";
import { loadGoldenCases } from "./golden-cases";
import {
  MemoryReviewStore,
  SupabaseReviewStore,
  type ReviewStore,
  type ReviewVerdict
} from "./review-store";
import {
  MemoryTimingStore,
  SupabaseTimingStore,
  summarizeTiming,
  type TimingStore
} from "./timing-store";

declare module "fastify" {
  interface FastifyRequest {
    actor: AuthenticatedActor | null;
  }
}

type BuildServerOptions = {
  store?: EncounterStore;
  sarvamClient?: {
    transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
    processDiarizedTranslation?(input: TranscriptionInput): Promise<{
      requestId: string | null;
      segments: DiarizedSegment[];
    }>;
    extractPacSuggestions(input: {
      turnId: string;
      transcript: string;
    }): Promise<PacSuggestion[]>;
    translateToKannada(
      input: string
    ): Promise<{ requestId: string | null; translatedText: string }>;
    synthesizeKannada(
      text: string
    ): Promise<{ requestId: string | null; audioBase64: string }>;
  };
  authenticator?: Authenticator;
  openAiPacClient?: {
    structurePacConversation(
      segments: DiarizedSegment[],
      checklistItems?: Array<{ itemId: string; label: string }>
    ): Promise<PacConversationStructure>;
    suggestChecklistForUnknownProcedure?(input: {
      procedure: string;
      existingItems: Array<{ itemId: string; label: string }>;
      categoryIds: string[];
    }): Promise<{
      modelRunId: string;
      suggestions: Array<{
        categoryId: string;
        question: string;
        rationale: string;
      }>;
    }>;
  };
  reviewStore?: ReviewStore;
  timingStore?: TimingStore;
};

const APPROVED_HANDOFF_TEXT =
  "Your pre-anesthetic check-up documentation is complete. Follow only the instructions confirmed by your clinician.";
const EXAMPLE_RECORDING_PATH = fileURLToPath(
  new URL("../../../Examples/WhatsApp Audio 2026-07-26 at 09.14.01.demo-29s.mp4", import.meta.url)
);
const COMPLETE_EXAMPLE_RECORDING_PATH = fileURLToPath(
  new URL("../../../Examples/WhatsApp Audio 2026-07-26 at 09.14.01.mp4", import.meta.url)
);

type SpeechExtractionClient = NonNullable<BuildServerOptions["sarvamClient"]>;

async function extractSpeechIntoEncounter(input: {
  encounter: Encounter;
  actorId: string;
  sarvamClient: SpeechExtractionClient;
  audio: {
    bytes: Buffer;
    filename: string;
    mimeType: string;
  };
  languageCode: SarvamLanguageCode;
}) {
  const transcription = await input.sarvamClient.transcribe({
    bytes: input.audio.bytes,
    filename: input.audio.filename,
    mimeType: input.audio.mimeType,
    languageCode: input.languageCode
  });
  const turnId = `live-${Date.now()}`;
  const rawSuggestions = await input.sarvamClient.extractPacSuggestions({
    turnId,
    transcript: transcription.transcript
  });
  const medicationUnknown =
    /blood[\s-]*thin|khoon\s+patla/i.test(transcription.transcript) &&
    /naam|name|yaad nahi|remember/i.test(transcription.transcript);
  const suggestions = rawSuggestions
    .filter(
      item =>
        ["medications", "allergies", "prior_anesthesia", "fasting", "open_items"].includes(
          item.field
        ) && item.sourceTurnIds.every(source => source === turnId)
    )
    .map(item =>
      item.field === "medications" && medicationUnknown
        ? {
            ...item,
            state: "uncertain" as const,
            value:
              "Patient describes a blood-thinning tablet; exact name is not recalled."
          }
        : item
    );
  const updated = {
    ...input.encounter,
    transcript: [
      ...input.encounter.transcript,
      {
        id: turnId,
        speaker: "patient" as const,
        language: transcription.languageCode ?? "unknown",
        original: transcription.transcript,
        translation: transcription.transcript,
        confidence: transcription.languageProbability ?? 0.85,
        offsetSeconds:
          (input.encounter.transcript.at(-1)?.offsetSeconds ?? 0) + 5
      }
    ],
    proposals: [
      ...input.encounter.proposals.filter(
        existing => !suggestions.some(item => item.field === existing.id)
      ),
      ...suggestions.map(item => ({
        id: item.field,
        label:
          item.field === "prior_anesthesia"
            ? "Previous anesthesia"
            : item.field.replaceAll("_", " "),
        state: item.state,
        value: item.value,
        sourceTurnIds: item.sourceTurnIds,
        required: input.encounter.requiredFieldIds.includes(item.field)
      }))
    ],
    audit: [
      ...input.encounter.audit,
      {
        id: crypto.randomUUID(),
        action: "speech.suggestions_created",
        actorId: input.actorId,
        occurredAt: new Date().toISOString(),
        detail: {
          turnId,
          suggestionCount: suggestions.length,
          model: "sarvam-30b",
          filename: input.audio.filename,
          clinicianReviewRequired: true
        }
      }
    ]
  };
  return { transcription, suggestions, encounter: updated };
}

function buildRecommendationQuestions(
  transcript: string
): RecommendationQuestion[] {
  const questions: RecommendationQuestion[] = [];
  if (/blood[\s-]*thin|khoon\s+patla|blood thinner/i.test(transcript)) {
    questions.push({
      id: "medication-name",
      question: "Ask the patient to show the medicine strip or prescription.",
      reason: "Blood thinner name is unknown."
    });
  }
  if (/fever|cough|cold|infection/i.test(transcript)) {
    questions.push({
      id: "recent-illness",
      question: "Ask when the fever or infection fully resolved.",
      reason: "Recent illness can change anaesthesia readiness."
    });
  }
  if (!questions.length) {
    questions.push({
      id: "confirm-open-items",
      question: "Ask if any medicines, allergies, or prior anaesthesia issues were missed.",
      reason: "No specific unresolved PAC risk was detected from the mock recording."
    });
  }
  return questions;
}

function encounterFromMockRecording(input: {
  encounter: Encounter;
  actorId: string;
  procedure?: string | undefined;
  transcript: string;
  sourceType: "live" | "uploaded_mp4";
}): Encounter {
  const turnId = `mock-${Date.now()}`;
  const medicationUnknown =
    /blood[\s-]*thin|khoon\s+patla|blood thinner/i.test(input.transcript) &&
    /name|naam|remember|yaad/i.test(input.transcript);
  const proposals = medicationUnknown
    ? [
        {
          id: "medications",
          label: "Current medicines",
          state: "uncertain" as const,
          value:
            "Patient reports a blood thinner, but the exact medicine name is not recalled.",
          sourceTurnIds: [turnId],
          required: true
        }
      ]
    : [
        {
          id: "open_items",
          label: "Open PAC items",
          state: "uncertain" as const,
          value: "Mock recording processed; clinician review is required.",
          sourceTurnIds: [turnId],
          required: false
        }
      ];

  return {
    ...input.encounter,
    procedure: input.procedure?.trim() || input.encounter.procedure,
    state: "clinician_review",
    sourceType: input.sourceType,
    recommendationQuestions: buildRecommendationQuestions(input.transcript),
    requiredFieldIds: ["medications"],
    transcript: [
      ...input.encounter.transcript,
      {
        id: turnId,
        speaker: "patient",
        language: input.encounter.preferredLanguage,
        original: input.transcript,
        translation: input.transcript,
        confidence: 0.93,
        offsetSeconds: (input.encounter.transcript.at(-1)?.offsetSeconds ?? 0) + 5
      }
    ],
    proposals,
    audit: [
      ...input.encounter.audit,
      {
        id: crypto.randomUUID(),
        action: "mock_recording.processed",
        actorId: input.actorId,
        occurredAt: new Date().toISOString(),
        detail: {
          sourceType: input.sourceType,
          recommendationQuestionCount:
            buildRecommendationQuestions(input.transcript).length
        }
      }
    ]
  };
}

function topicCounts(turns: PacConversationTurn[]) {
  return turns.reduce<Record<string, number>>((counts, turn) => {
    counts[turn.topic] = (counts[turn.topic] ?? 0) + 1;
    return counts;
  }, {});
}

function encounterFromDiarizedRecording(input: {
  encounter: Encounter;
  actorId: string;
  sarvamRequestId: string | null;
  segments: DiarizedSegment[];
  turns: PacConversationTurn[];
  checklistProposals: PacConversationStructure["checklistProposals"];
  customerSummary?: string;
}): Encounter {
  const bySegmentId = new Map(input.turns.map(turn => [turn.segmentId, turn]));
  const transcript: TranscriptTurn[] = input.segments.map(segment => {
    const turn = bySegmentId.get(segment.id);
    const speaker: TranscriptTurn["speaker"] =
      turn?.speakerRole === "clinician"
        ? "clinician"
        : turn?.speakerRole === "patient"
          ? "patient"
          : "system";
    return {
      id: segment.id,
      speaker,
      language: "en-IN",
      original: segment.originalText,
      translation: segment.translatedText,
      confidence: 0.9,
      offsetSeconds: segment.startSeconds
    };
  });
  const evaluated = withEvaluatedChecklist(input.encounter).checklist!;
  const generatedProposals = materializeChecklistProposals({
    applicableItems: evaluated.items
      .filter(item => item.applicable)
      .map(item => ({
        id: item.id,
        label: item.label,
        required: item.required,
        authority: item.authority
      })),
    modelItems: input.checklistProposals.map(item => ({
      itemId: item.itemId,
      state: item.state,
      value: item.value,
      sourceTurnIds: item.sourceSegmentIds
    })),
    transcript
  });
  const preservedProposals = input.encounter.proposals.filter(
    proposal =>
      ["clinician_entered", "intentionally_skipped"].includes(proposal.state) &&
      !generatedProposals.some(generated => generated.id === proposal.id)
  );

  return withEvaluatedChecklist({
    ...input.encounter,
    state: "clinician_review",
    sourceType: "uploaded_mp4",
    customerSummary: input.customerSummary,
    transcript: [...input.encounter.transcript, ...transcript],
    proposals: [...preservedProposals, ...generatedProposals],
    recommendationQuestions: buildRecommendationQuestions(
      input.segments.map(segment => segment.translatedText).join(" ")
    ),
    audit: [
      ...input.encounter.audit,
      {
        id: crypto.randomUUID(),
        action: "recording.synthetic_processed",
        actorId: input.actorId,
        occurredAt: new Date().toISOString(),
        detail: {
          syntheticDemo: true,
          filename: basename(COMPLETE_EXAMPLE_RECORDING_PATH),
          sarvamRequestId: input.sarvamRequestId,
          segmentCount: input.segments.length,
          customerSummaryGenerated: Boolean(input.customerSummary),
          customerSummary: input.customerSummary,
          topicCounts: topicCounts(input.turns),
          clinicianReviewRequired: true,
          model: "gpt-5.6-sol"
        }
      }
    ]
  });
}

export async function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({ logger: false });
  const configuredSupabaseStore =
    process.env.USE_SUPABASE_STORE === "true"
      ? SupabaseEncounterStore.fromEnvironment()
      : null;
  const store =
    options.store ??
    configuredSupabaseStore ??
    new MemoryEncounterStore(createDemoEncounters());

  await server.register(cors, {
    origin: process.env.WEB_ORIGIN ?? false,
    credentials: true
  });
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        "media-src": ["'self'", "data:"],
        "connect-src": [
          "'self'",
          ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : [])
        ]
      }
    }
  });
  await server.register(multipart, {
    limits: { files: 1, fileSize: 10 * 1024 * 1024 }
  });
  const webDistribution = fileURLToPath(
    new URL("../../web/dist", import.meta.url)
  );
  if (existsSync(webDistribution)) {
    await server.register(staticFiles, {
      root: webDistribution,
      index: "index.html",
      cacheControl: true,
      maxAge: "1h",
      immutable: false
    });
    server.addHook("onSend", async (_request, reply, payload) => {
      const contentType = String(reply.getHeader("content-type") ?? "");
      if (contentType.includes("text/html")) {
        reply.header("cache-control", "no-store");
      }
      return payload;
    });
  }

  const sarvamClient =
    options.sarvamClient ??
    (process.env.SARVAM_API_KEY
      ? new SarvamClient(process.env.SARVAM_API_KEY)
      : null);
  const openAiPacClient =
    options.openAiPacClient ??
    (process.env.OPENAI_API_KEY
      ? new OpenAiPacClient(process.env.OPENAI_API_KEY)
      : null);
  const telegramClient = process.env.TELEGRAM_BOT_TOKEN
    ? new TelegramClient(process.env.TELEGRAM_BOT_TOKEN)
    : null;
  const authenticator =
    options.authenticator ?? SupabaseAuthenticator.fromEnvironment();
  const reviewStore =
    options.reviewStore ??
    SupabaseReviewStore.fromEnvironment() ??
    new MemoryReviewStore();
  const goldenCases = loadGoldenCases();
  const timingStore =
    options.timingStore ??
    SupabaseTimingStore.fromEnvironment() ??
    new MemoryTimingStore();

  server.decorateRequest("actor", null);
  server.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const token = bearerToken(request.headers.authorization);
    if (!token || !authenticator) {
      return reply.code(401).send({
        code: "AUTH_REQUIRED",
        message: "Sign in as an authorized clinician to continue."
      });
    }
    const actor = await authenticator.authenticate(token);
    if (!actor) {
      return reply.code(403).send({
        code: "ACCESS_DENIED",
        message: "This account is not authorized for a Vaanaya organization."
      });
    }
    request.actor = actor;
  });

  server.get("/health", async () => ({
    status: "ok",
    mode:
      process.env.SARVAM_API_KEY && process.env.SUPABASE_URL
        ? "connected"
        : "deterministic-demo",
    sarvamConfigured: Boolean(process.env.SARVAM_API_KEY),
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ),
    telegramConfigured: Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_DEMO_CHAT_ID
    )
  }));

  server.get<{ Querystring: { q?: string } }>("/api/patients", async request => {
    return store.searchPatients({
      organizationId: request.actor!.organizationId,
      query: request.query.q ?? ""
    });
  });

  server.get("/api/recordings", async (request, reply) => {
    try {
      return await store.listRecordings({
        organizationId: request.actor!.organizationId
      });
    } catch (error) {
      request.log.error({ error }, "Recordings worklist unavailable");
      return reply.code(503).send({
        code: "RECORDINGS_WORKLIST_UNAVAILABLE",
        message: "The recordings worklist is unavailable in this storage mode."
      });
    }
  });

  server.post<{
    Body: { displayName?: string; mobileNumber?: string };
  }>("/api/patients", async (request, reply) => {
    const displayName = request.body?.displayName?.trim();
    const mobileNumber = request.body?.mobileNumber?.trim();
    if (!displayName || !mobileNumber) {
      return reply.code(400).send({
        code: "INVALID_PATIENT",
        message: "Patient name and mobile number are required."
      });
    }
    const patient = await store.createPatient({
      organizationId: request.actor!.organizationId,
      actorId: request.actor!.id,
      displayName,
      mobileNumber
    });
    return reply.code(201).send(patient);
  });

  server.post<{
    Body: {
      patientId?: string;
      procedure?: string;
      preferredLanguage?: string;
      sourceType?: "live" | "uploaded_mp4";
    };
  }>("/api/encounters", async (request, reply) => {
    const { patientId, procedure, preferredLanguage, sourceType } =
      request.body ?? {};
    if (!patientId || !procedure || !preferredLanguage || !sourceType) {
      return reply.code(400).send({
        code: "INVALID_ENCOUNTER",
        message: "Patient, procedure, language, and recording source are required."
      });
    }
    try {
      let encounter = await store.createEncounter({
        organizationId: request.actor!.organizationId,
        actorId: request.actor!.id,
        patientId,
        procedure,
        preferredLanguage,
        sourceType
      });
      if (normalizeProcedureFamily(procedure) === "generic") {
        const normalizedProcedure = normalizeProcedureLibraryKey(procedure);
        const published = await store.findChecklistLibraryVersion({
          organizationId: request.actor!.organizationId,
          normalizedProcedure
        });
        if (published) {
          encounter = withEvaluatedChecklist({
            ...encounter,
            checklistExtensions: published.items,
            checklistLibrary: {
              normalizedProcedure,
              version: published.version,
              source: published.source
            }
          });
        } else if (openAiPacClient?.suggestChecklistForUnknownProcedure) {
          try {
            const generated =
              await openAiPacClient.suggestChecklistForUnknownProcedure({
                procedure,
                existingItems: SYNTHETIC_PAC_TEMPLATE.items.map(item => ({
                  itemId: item.id,
                  label: item.label
                })),
                categoryIds: SYNTHETIC_PAC_TEMPLATE.categories.map(
                  category => category.id
                )
              });
            encounter = withEvaluatedChecklist({
              ...encounter,
              checklistSuggestions: sanitizeUnknownProcedureSuggestions({
                procedure,
                modelRunId: generated.modelRunId,
                categoryIds: SYNTHETIC_PAC_TEMPLATE.categories.map(
                  category => category.id
                ),
                suggestions: generated.suggestions
              })
            });
          } catch {
            encounter = {
              ...encounter,
              audit: [
                ...encounter.audit,
                {
                  id: crypto.randomUUID(),
                  action: "checklist.suggestion_generation_failed",
                  actorId: "system",
                  occurredAt: new Date().toISOString(),
                  detail: { genericCoverageRetained: true }
                }
              ]
            };
          }
        }
        encounter = await store.save(encounter);
      }
      return reply.code(201).send(encounter);
    } catch (error) {
      return reply.code(404).send({
        code: "PATIENT_NOT_FOUND",
        message: error instanceof Error ? error.message : "Patient not found."
      });
    }
  });

  server.post<{
    Params: { id: string };
    Body: {
      sourceType?: "live" | "uploaded_mp4";
      procedure?: string;
      transcript?: string;
    };
  }>("/api/encounters/:id/mock-recording", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "Encounter not found." });
    }
    const sourceType = request.body?.sourceType ?? encounter.sourceType ?? "live";
    const transcript = request.body?.transcript?.trim();
    if (!transcript) {
      return reply.code(400).send({
        code: "TRANSCRIPT_REQUIRED",
        message: "Mock recording transcript is required."
      });
    }
    const saved = await store.save(
      encounterFromMockRecording({
        encounter,
        actorId: request.actor!.id,
        procedure: request.body?.procedure,
        transcript,
        sourceType
      })
    );
    return saved;
  });

  server.post<{
    Params: { id: string };
  }>("/api/encounters/:id/second-opinion", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "Encounter not found." });
    }
    const requestedAt = new Date().toISOString();
    const saved = await store.save({
      ...encounter,
      secondOpinionRequested: true,
      secondOpinionRequestedBy: request.actor!.id,
      secondOpinionRequestedAt: requestedAt,
      audit: [
        ...encounter.audit,
        {
          id: crypto.randomUUID(),
          action: "second_opinion.requested",
          actorId: request.actor!.id,
          occurredAt: requestedAt,
          detail: {
            patientReference: encounter.patientReference
          }
        }
      ]
    });
    return saved;
  });

  server.get("/api/reviews/golden-cases", async request => {
    const reviews = await reviewStore.list(request.actor!.organizationId);
    const byCaseId = new Map(reviews.map(review => [review.caseId, review]));
    return {
      cases: goldenCases.map(goldenCase => ({
        ...goldenCase,
        review: byCaseId.get(goldenCase.caseId) ?? null
      })),
      completed: reviews.length,
      total: goldenCases.length
    };
  });

  server.put<{
    Params: { caseId: string };
    Body: { verdict?: ReviewVerdict; notes?: string; confidence?: number };
  }>("/api/reviews/golden-cases/:caseId", async (request, reply) => {
    if (request.actor?.role !== "clinician") {
      return reply.code(403).send({
        code: "CLINICIAN_REQUIRED",
        message: "An anesthesiologist or clinician must record this review."
      });
    }
    const verdicts: ReviewVerdict[] = [
      "approved",
      "needs_revision",
      "unsafe"
    ];
    const { verdict, notes, confidence } = request.body ?? {};
    if (
      !verdict ||
      !verdicts.includes(verdict) ||
      typeof notes !== "string" ||
      typeof confidence !== "number" ||
      !Number.isInteger(confidence) ||
      confidence < 1 ||
      confidence > 5 ||
      !goldenCases.some(item => item.caseId === request.params.caseId)
    ) {
      return reply.code(400).send({
        code: "INVALID_REVIEW",
        message:
          "Choose an approved verdict, confidence from 1–5, and provide review notes."
      });
    }
    return reviewStore.save(request.actor.organizationId, {
      caseId: request.params.caseId,
      verdict,
      notes: notes.trim(),
      confidence,
      reviewerId: request.actor.id
    });
  });

  server.get("/api/evidence/timing", async request => {
    const observations = await timingStore.list(request.actor!.organizationId);
    return { observations, summary: summarizeTiming(observations) };
  });

  server.put<{
    Params: { scenarioId: string };
    Body: {
      scenarioId?: string;
      paperSeconds?: number;
      vaanayaSeconds?: number;
      paperCorrections?: number;
      vaanayaCorrections?: number;
      notes?: string;
    };
  }>("/api/evidence/timing/:scenarioId", async (request, reply) => {
    if (!["clinician", "coordinator"].includes(request.actor!.role)) {
      return reply.code(403).send({
        code: "CLINICAL_STAFF_REQUIRED",
        message: "Clinical staff must record timing observations."
      });
    }
    const body = request.body ?? {};
    const durationValid = (value: unknown) =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= 7200;
    const countValid = (value: unknown) =>
      typeof value === "number" && Number.isInteger(value) && value >= 0;
    if (
      !durationValid(body.paperSeconds) ||
      !durationValid(body.vaanayaSeconds) ||
      !countValid(body.paperCorrections) ||
      !countValid(body.vaanayaCorrections) ||
      typeof body.notes !== "string"
    ) {
      return reply.code(400).send({
        code: "INVALID_TIMING",
        message: "Enter paired durations and correction counts."
      });
    }
    return timingStore.save(request.actor!.organizationId, {
      scenarioId: request.params.scenarioId,
      paperSeconds: body.paperSeconds!,
      vaanayaSeconds: body.vaanayaSeconds!,
      paperCorrections: body.paperCorrections!,
      vaanayaCorrections: body.vaanayaCorrections!,
      notes: body.notes.trim(),
      observedBy: request.actor!.id
    });
  });

  server.post<{
    Querystring: { languageCode?: SarvamLanguageCode };
  }>("/api/speech/transcribe", async (request, reply) => {
    if (!sarvamClient) {
      return reply.code(503).send({
        code: "SARVAM_NOT_CONFIGURED",
        message: "Speech transcription is not configured."
      });
    }

    const audio = await request.file();
    if (!audio) {
      return reply.code(400).send({
        code: "AUDIO_REQUIRED",
        message: "A single audio file is required."
      });
    }

    try {
      const result = await sarvamClient.transcribe({
        bytes: await audio.toBuffer(),
        filename: audio.filename,
        mimeType: audio.mimetype,
        languageCode: request.query.languageCode ?? "unknown"
      });
      return result;
    } catch (error) {
      request.log.error({ error }, "Sarvam transcription failed");
      return reply.code(502).send({
        code: "TRANSCRIPTION_FAILED",
        message: "The audio could not be transcribed. Please retry."
      });
    }
  });

  server.post<{
    Params: { id: string };
    Querystring: { languageCode?: SarvamLanguageCode };
  }>("/api/encounters/:id/speech", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "Encounter not found." });
    }
    if (!encounter.consentRecorded || encounter.state !== "clinician_review") {
      return reply.code(409).send({
        code: "CAPTURE_NOT_ALLOWED",
        message: "Speech capture requires consent and clinician review state."
      });
    }
    if (!sarvamClient) {
      return reply.code(503).send({
        code: "SARVAM_NOT_CONFIGURED",
        message: "Speech transcription is not configured."
      });
    }
    const audio = await request.file();
    if (!audio) {
      return reply.code(400).send({
        code: "AUDIO_REQUIRED",
        message: "A single audio file is required."
      });
    }
    try {
      const extracted = await extractSpeechIntoEncounter({
        encounter,
        actorId: request.actor!.id,
        sarvamClient,
        audio: {
          bytes: await audio.toBuffer(),
          filename: audio.filename,
          mimeType: audio.mimetype
        },
        languageCode: request.query.languageCode ?? "unknown"
      });
      const saved = await store.save(extracted.encounter);
      return { ...extracted, encounter: saved };
    } catch (error) {
      request.log.error({ error }, "Encounter speech extraction failed");
      return reply.code(502).send({
        code: "SPEECH_EXTRACTION_FAILED",
        message: "Speech could not be converted into review suggestions."
      });
    }
  });

  server.post<{
    Params: { id: string };
    Querystring: { languageCode?: SarvamLanguageCode };
  }>("/api/encounters/:id/example-recording", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "Encounter not found." });
    }
    if (!encounter.consentRecorded || encounter.state !== "clinician_review") {
      return reply.code(409).send({
        code: "CAPTURE_NOT_ALLOWED",
        message: "Example recording upload requires consent and clinician review state."
      });
    }
    if (!sarvamClient) {
      return reply.code(503).send({
        code: "SARVAM_NOT_CONFIGURED",
        message: "Sarvam transcription is not configured."
      });
    }
    try {
      const extracted = await extractSpeechIntoEncounter({
        encounter,
        actorId: request.actor!.id,
        sarvamClient,
        audio: {
          bytes: await readFile(EXAMPLE_RECORDING_PATH),
          filename: basename(EXAMPLE_RECORDING_PATH),
          mimeType: "audio/mp4"
        },
        languageCode: request.query.languageCode ?? "hi-IN"
      });
      const saved = await store.save(extracted.encounter);
      return { ...extracted, encounter: saved };
    } catch (error) {
      request.log.error({ error }, "Example recording extraction failed");
      return reply.code(502).send({
        code: "EXAMPLE_RECORDING_FAILED",
        message: "The example MP4 could not be converted into evidence."
      });
    }
  });

  server.post<{
    Params: { id: string };
  }>("/api/encounters/:id/complete-example-recording", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "Encounter not found." });
    }
    if (!encounter.consentRecorded || encounter.state !== "clinician_review") {
      return reply.code(409).send({
        code: "CAPTURE_NOT_ALLOWED",
        message:
          "Complete synthetic recording upload requires consent and clinician review state."
      });
    }
    const completeRecordingFilename = basename(COMPLETE_EXAMPLE_RECORDING_PATH);
    const alreadyProcessed = encounter.audit.some(
      event =>
        event.action === "recording.synthetic_processed" &&
        event.detail?.filename === completeRecordingFilename
    );
    if (alreadyProcessed && encounter.transcript.length > 0) {
      return { status: "cached" as const, encounter };
    }
    if (!sarvamClient?.processDiarizedTranslation) {
      return reply.code(503).send({
        code: "SARVAM_BATCH_NOT_CONFIGURED",
        message: "Sarvam batch diarized translation is not configured."
      });
    }
    if (!openAiPacClient) {
      return reply.code(503).send({
        code: "OPENAI_NOT_CONFIGURED",
        message: "OpenAI PAC structuring is not configured."
      });
    }
    try {
      const sarvamResult = await sarvamClient.processDiarizedTranslation({
        bytes: await readFile(COMPLETE_EXAMPLE_RECORDING_PATH),
        filename: basename(COMPLETE_EXAMPLE_RECORDING_PATH),
        mimeType: "audio/mp4",
        languageCode: "hi-IN"
      });
      const activeChecklist = withEvaluatedChecklist(encounter).checklist!;
      const structure = await openAiPacClient.structurePacConversation(
        sarvamResult.segments,
        activeChecklist.items
          .filter(
            item =>
              item.applicable && item.authority === "evidence_or_clinician"
          )
          .map(item => ({ itemId: item.id, label: item.label }))
      );
      const saved = await store.save(
        encounterFromDiarizedRecording({
          encounter,
          actorId: request.actor!.id,
          sarvamRequestId: sarvamResult.requestId,
          segments: sarvamResult.segments,
          turns: structure.turns,
          checklistProposals: structure.checklistProposals,
          customerSummary: structure.customerSummary
        })
      );
      return { status: "completed" as const, encounter: saved };
    } catch (error) {
      request.log.error({ error }, "Complete synthetic recording processing failed");
      return reply.code(502).send({
        code: "COMPLETE_SYNTHETIC_RECORDING_FAILED",
        message:
          "The complete synthetic recording could not be diarized, translated, or structured."
      });
    }
  });

  server.post<{ Params: { id: string } }>(
    "/api/encounters/:id/kannada-handoff",
    async (request, reply) => {
      const encounter = await store.get(request.params.id);
      if (!encounter) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Encounter not found."
        });
      }
      if (encounter.state !== "signed") {
        return reply.code(409).send({
          code: "HANDOFF_NOT_APPROVED",
          message: "The clinician must sign the PAC note before patient handoff."
        });
      }
      if (!sarvamClient) {
        return reply.code(503).send({
          code: "SARVAM_NOT_CONFIGURED",
          message: "Patient-language handoff is not configured."
        });
      }
      try {
        const translation =
          await sarvamClient.translateToKannada(APPROVED_HANDOFF_TEXT);
        const speech = await sarvamClient.synthesizeKannada(
          translation.translatedText
        );
        return {
          sourceText: APPROVED_HANDOFF_TEXT,
          translatedText: translation.translatedText,
          languageCode: "kn-IN",
          audioBase64: speech.audioBase64,
          audioMimeType: "audio/mpeg"
        };
      } catch (error) {
        request.log.error({ error }, "Kannada handoff failed");
        return reply.code(502).send({
          code: "HANDOFF_FAILED",
          message: "The Kannada handoff could not be generated. Please retry."
        });
      }
    }
  );

  server.post<{ Params: { id: string } }>(
    "/api/encounters/:id/telegram-handoff",
    async (request, reply) => {
      const encounter = await store.get(request.params.id);
      if (!encounter) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Encounter not found."
        });
      }
      if (encounter.state !== "signed") {
        return reply.code(409).send({
          code: "HANDOFF_NOT_APPROVED",
          message: "The clinician must sign the PAC note before delivery."
        });
      }
      const chatId = process.env.TELEGRAM_DEMO_CHAT_ID;
      if (!sarvamClient || !telegramClient || !chatId) {
        return reply.code(503).send({
          code: "TELEGRAM_NOT_CONFIGURED",
          message: "Telegram delivery is not configured."
        });
      }
      try {
        const translation =
          await sarvamClient.translateToKannada(APPROVED_HANDOFF_TEXT);
        const speech = await sarvamClient.synthesizeKannada(
          translation.translatedText
        );
        const delivery = await telegramClient.sendPatientAudio({
          chatId,
          caption: translation.translatedText,
          audioBase64: speech.audioBase64
        });
        return {
          delivered: true,
          messageId: delivery.messageId,
          languageCode: "kn-IN"
        };
      } catch (error) {
        request.log.error({ error }, "Telegram handoff failed");
        return reply.code(502).send({
          code: "TELEGRAM_DELIVERY_FAILED",
          message: "The patient handoff could not be delivered. Please retry."
        });
      }
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/encounters/:id",
    async (request, reply) => {
      const encounter = await store.get(request.params.id);
      if (!encounter) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Encounter not found."
        });
      }
      return encounter;
    }
  );

  server.patch<{
    Params: { id: string; proposalId: string };
    Body: { value?: string; actorId?: string };
  }>(
    "/api/encounters/:id/proposals/:proposalId",
    async (request, reply) => {
      const encounter = await store.get(request.params.id);
      if (!encounter) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Encounter not found."
        });
      }
      if (!request.body?.value) {
        return reply.code(400).send({
          code: "INVALID_COMMAND",
          message: "value is required."
        });
      }
      try {
        const updated = resolveProposal(encounter, {
          proposalId: request.params.proposalId,
          value: request.body.value,
          actorId: request.actor!.id
        });
        return await store.save(updated);
      } catch (error) {
        return reply.code(409).send({
          code: "WORKFLOW_CONFLICT",
          message: error instanceof Error ? error.message : "Workflow conflict."
        });
      }
    }
  );

  server.patch<{
    Params: { id: string; itemId: string };
    Body: { value?: string };
  }>("/api/encounters/:id/checklist/:itemId", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter)
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "Encounter not found."
      });
    if (request.actor?.role !== "clinician")
      return reply.code(403).send({
        code: "CLINICIAN_REQUIRED",
        message: "Only a clinician can enter checklist content."
      });
    if (!request.body?.value?.trim())
      return reply.code(400).send({
        code: "INVALID_COMMAND",
        message: "value is required."
      });
    try {
      return await store.save(
        enterChecklistItem(encounter, {
          itemId: request.params.itemId,
          value: request.body.value,
          actorId: request.actor.id
        })
      );
    } catch (error) {
      return reply.code(409).send({
        code: "WORKFLOW_CONFLICT",
        message: error instanceof Error ? error.message : "Workflow conflict."
      });
    }
  });

  server.post<{
    Params: { id: string; itemId: string };
    Body: { reason?: string };
  }>("/api/encounters/:id/checklist/:itemId/defer", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter)
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "Encounter not found."
      });
    if (request.actor?.role !== "clinician")
      return reply.code(403).send({
        code: "CLINICIAN_REQUIRED",
        message: "Only a clinician can defer checklist content."
      });
    if (!request.body?.reason?.trim())
      return reply.code(400).send({
        code: "INVALID_COMMAND",
        message: "reason is required."
      });
    try {
      return await store.save(
        deferChecklistItem(encounter, {
          itemId: request.params.itemId,
          reason: request.body.reason,
          actorId: request.actor.id
        })
      );
    } catch (error) {
      return reply.code(409).send({
        code: "WORKFLOW_CONFLICT",
        message: error instanceof Error ? error.message : "Workflow conflict."
      });
    }
  });

  for (const decision of ["approved", "rejected"] as const) {
    server.post<{ Params: { id: string; suggestionId: string } }>(
      `/api/encounters/:id/checklist-suggestions/:suggestionId/${
        decision === "approved" ? "approve" : "reject"
      }`,
      async (request, reply) => {
        const encounter = await store.get(request.params.id);
        if (!encounter)
          return reply.code(404).send({
            code: "NOT_FOUND",
            message: "Encounter not found."
          });
        if (request.actor?.role !== "clinician")
          return reply.code(403).send({
            code: "CLINICIAN_REQUIRED",
            message: "Only a clinician can decide checklist suggestions."
          });
        try {
          const checklistSuggestions = decideChecklistSuggestion({
            suggestions: encounter.checklistSuggestions,
            suggestionId: request.params.suggestionId,
            decision,
            actorId: request.actor.id
          });
          const approvedExtensions = checklistSuggestions
            .filter(item => item.approvalState === "approved")
            .map(item => ({
              id: item.id,
              categoryId: item.categoryId,
              label: item.question,
              question: item.question,
              rationale: item.rationale,
              required: false as const,
              authority: "evidence_or_clinician" as const,
              severity: "standard" as const,
              deferrable: true as const,
              applicability: { kind: "always" as const }
            }));
          return await store.save(
            withEvaluatedChecklist({
              ...encounter,
              checklistSuggestions,
              checklistExtensions: approvedExtensions,
              audit: [
                ...encounter.audit,
                {
                  id: crypto.randomUUID(),
                  action: `checklist.suggestion_${decision}`,
                  actorId: request.actor.id,
                  occurredAt: new Date().toISOString(),
                  detail: { suggestionId: request.params.suggestionId }
                }
              ]
            })
          );
        } catch (error) {
          return reply.code(409).send({
            code: "WORKFLOW_CONFLICT",
            message:
              error instanceof Error ? error.message : "Workflow conflict."
          });
        }
      }
    );
  }

  server.post<{ Params: { id: string } }>(
    "/api/encounters/:id/checklist-suggestions/publish",
    async (request, reply) => {
      const encounter = await store.get(request.params.id);
      if (!encounter)
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Encounter not found."
        });
      if (request.actor?.role !== "clinician")
        return reply.code(403).send({
          code: "CLINICIAN_REQUIRED",
          message: "Only a clinician can publish a checklist."
        });
      const normalizedProcedure = normalizeProcedureLibraryKey(
        encounter.procedure
      );
      const latest = await store.findChecklistLibraryVersion({
        organizationId: request.actor.organizationId,
        normalizedProcedure
      });
      try {
        const published = buildPublishedChecklistVersion({
          organizationId: request.actor.organizationId,
          procedure: encounter.procedure,
          suggestions: encounter.checklistSuggestions,
          latestVersion: latest?.version ?? 0,
          actorId: request.actor.id
        });
        await store.publishChecklistLibraryVersion(published);
        return await store.save(
          withEvaluatedChecklist({
            ...encounter,
            checklistExtensions: published.items,
            checklistLibrary: {
              normalizedProcedure,
              version: published.version,
              source: published.source
            },
            audit: [
              ...encounter.audit,
              {
                id: crypto.randomUUID(),
                action: "checklist.library_published",
                actorId: request.actor.id,
                occurredAt: new Date().toISOString(),
                detail: {
                  normalizedProcedure,
                  version: published.version
                }
              }
            ]
          })
        );
      } catch (error) {
        return reply.code(409).send({
          code: "WORKFLOW_CONFLICT",
          message:
            error instanceof Error ? error.message : "Workflow conflict."
        });
      }
    }
  );

  server.post<{
    Params: { id: string };
    Body: {
      actorId?: string;
      actorRole?: "clinician" | "coordinator";
    };
  }>("/api/encounters/:id/sign", async (request, reply) => {
    const encounter = await store.get(request.params.id);
    if (!encounter) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "Encounter not found."
      });
    }
    if (request.actor?.role !== "clinician") {
      return reply.code(403).send({
        code: "CLINICIAN_REQUIRED",
        message: "Only a clinician can sign a PAC note."
      });
    }
    if (!request.body?.actorRole) {
      return reply.code(400).send({
        code: "INVALID_COMMAND",
        message: "actorRole is required."
      });
    }
    try {
      const signed = signEncounter(encounter, {
        actorId: request.actor.id,
        actorRole: request.actor.role
      });
      return await store.save(signed);
    } catch (error) {
      return reply.code(409).send({
        code: "WORKFLOW_CONFLICT",
        message: error instanceof Error ? error.message : "Workflow conflict."
      });
    }
  });

  if (existsSync(webDistribution)) {
    server.get("/review", async (_request, reply) => reply.sendFile("index.html"));
    server.get("/evidence", async (_request, reply) =>
      reply.sendFile("index.html")
    );
  }

  return server;
}
