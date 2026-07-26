import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveProposal, signEncounter } from "@vaanaya/contracts";
import { createDemoEncounter } from "./demo-encounter";
import {
  MemoryEncounterStore,
  type EncounterStore
} from "./encounter-store";
import {
  SarvamClient,
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
  reviewStore?: ReviewStore;
  timingStore?: TimingStore;
};

const APPROVED_HANDOFF_TEXT =
  "Your pre-anesthetic check-up documentation is complete. Follow only the instructions confirmed by your clinician.";

export async function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({ logger: false });
  const configuredSupabaseStore =
    process.env.USE_SUPABASE_STORE === "true"
      ? SupabaseEncounterStore.fromEnvironment()
      : null;
  const store =
    options.store ??
    configuredSupabaseStore ??
    new MemoryEncounterStore([createDemoEncounter()]);

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
  }

  const sarvamClient =
    options.sarvamClient ??
    (process.env.SARVAM_API_KEY
      ? new SarvamClient(process.env.SARVAM_API_KEY)
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
      const transcription = await sarvamClient.transcribe({
        bytes: await audio.toBuffer(),
        filename: audio.filename,
        mimeType: audio.mimetype,
        languageCode: request.query.languageCode ?? "unknown"
      });
      const turnId = `live-${Date.now()}`;
      const rawSuggestions = await sarvamClient.extractPacSuggestions({
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
        ...encounter,
        transcript: [
          ...encounter.transcript,
          {
            id: turnId,
            speaker: "patient" as const,
            language: transcription.languageCode ?? "unknown",
            original: transcription.transcript,
            translation: transcription.transcript,
            confidence: transcription.languageProbability ?? 0.85,
            offsetSeconds:
              (encounter.transcript.at(-1)?.offsetSeconds ?? 0) + 5
          }
        ],
        proposals: [
          ...encounter.proposals.filter(
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
            required: encounter.requiredFieldIds.includes(item.field)
          }))
        ],
        audit: [
          ...encounter.audit,
          {
            id: crypto.randomUUID(),
            action: "speech.suggestions_created",
            actorId: request.actor!.id,
            occurredAt: new Date().toISOString(),
            detail: {
              turnId,
              suggestionCount: suggestions.length,
              model: "sarvam-30b",
              clinicianReviewRequired: true
            }
          }
        ]
      };
      const saved = await store.save(updated);
      return { transcription, suggestions, encounter: saved };
    } catch (error) {
      request.log.error({ error }, "Encounter speech extraction failed");
      return reply.code(502).send({
        code: "SPEECH_EXTRACTION_FAILED",
        message: "Speech could not be converted into review suggestions."
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
