import { z } from "zod";
import {
  CHECKLIST_TEMPLATE_ID,
  CHECKLIST_VERSION,
  ChecklistContextSchema,
  ChecklistItemDefinitionSchema,
  ChecklistLibraryReferenceSchema,
  ChecklistSuggestionSchema,
  EvaluatedChecklistSchema,
  SYNTHETIC_PAC_TEMPLATE,
  checklistBlockers,
  evaluateChecklist
} from "./checklist";

export * from "./checklist";

export const EncounterStateSchema = z.enum([
  "created",
  "consented",
  "recording",
  "processing",
  "clinician_review",
  "signed",
  "summary_approved",
  "shared"
]);

export type EncounterState = z.infer<typeof EncounterStateSchema>;

export const FieldStateSchema = z.enum([
  "captured",
  "uncertain",
  "missing",
  "intentionally_skipped",
  "clinician_entered"
]);
export type FieldState = z.infer<typeof FieldStateSchema>;

export const TranscriptTurnSchema = z.object({
  id: z.string().min(1),
  speaker: z.enum(["clinician", "patient", "caregiver", "system"]),
  language: z.string().min(2),
  original: z.string().min(1),
  translation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  offsetSeconds: z.number().nonnegative()
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

export const FieldProposalSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    state: FieldStateSchema,
    value: z.string(),
    sourceTurnIds: z.array(z.string()),
    required: z.boolean()
  })
  .superRefine((proposal, context) => {
    if (
      ["captured", "uncertain"].includes(proposal.state) &&
      proposal.sourceTurnIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceTurnIds"],
        message: "Captured and uncertain proposals require source evidence."
      });
    }
  });

export const PatientSummarySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  mobileNumber: z.string().min(1),
  mobileLast4: z.string().min(4).max(4)
});

export type PatientSummary = z.infer<typeof PatientSummarySchema>;

export const RecordingStatusSchema = z.enum([
  "uploaded",
  "processing",
  "ready_for_review",
  "signed",
  "failed"
]);

export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

export const RecordingListItemSchema = z.object({
  encounterId: z.string().min(1),
  patient: PatientSummarySchema,
  synthetic: z.literal(true),
  procedure: z.string().min(1),
  preferredLanguage: z.string().min(2),
  recordedAt: z.string().datetime(),
  status: RecordingStatusSchema,
  answeredCount: z.number().int().nonnegative(),
  applicableCount: z.number().int().positive(),
  criticalGapCount: z.number().int().nonnegative(),
  hasTranscript: z.boolean()
});

export type RecordingListItem = z.infer<typeof RecordingListItemSchema>;
export const RecordingListSchema = z.array(RecordingListItemSchema);

export const RecommendationQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  reason: z.string().min(1)
});

export type RecommendationQuestion = z.infer<
  typeof RecommendationQuestionSchema
>;

export const AuditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string(),
  occurredAt: z.string().datetime(),
  detail: z.record(z.string(), z.unknown())
});

export const EncounterSchema = z.object({
  id: z.string().min(1),
  patient: PatientSummarySchema.optional(),
  patientReference: z.string().min(1),
  procedure: z.string().min(1),
  preferredLanguage: z.string().min(2),
  state: EncounterStateSchema,
  consentRecorded: z.boolean(),
  sourceType: z.enum(["live", "uploaded_mp4"]).optional(),
  customerSummary: z.string().min(1).optional(),
  secondOpinionRequested: z.boolean().optional(),
  secondOpinionRequestedBy: z.string().min(1).optional(),
  secondOpinionRequestedAt: z.string().datetime().optional(),
  recommendationQuestions: z.array(RecommendationQuestionSchema).optional(),
  checklistContext: ChecklistContextSchema.default({
    templateId: CHECKLIST_TEMPLATE_ID,
    version: CHECKLIST_VERSION,
    contextFlags: []
  }),
  checklist: EvaluatedChecklistSchema.optional(),
  checklistSuggestions: z.array(ChecklistSuggestionSchema).default([]),
  checklistExtensions: z
    .array(ChecklistItemDefinitionSchema)
    .default([]),
  checklistLibrary: ChecklistLibraryReferenceSchema.optional(),
  requiredFieldIds: z.array(z.string()),
  proposals: z.array(FieldProposalSchema),
  transcript: z.array(TranscriptTurnSchema),
  audit: z.array(AuditEventSchema)
});

export type Encounter = z.infer<typeof EncounterSchema>;

export function withEvaluatedChecklist(encounterInput: Encounter): Encounter {
  const encounter = EncounterSchema.parse(encounterInput);
  return EncounterSchema.parse({
    ...encounter,
    checklist: evaluateChecklist({
      procedure: encounter.procedure,
      contextFlags: encounter.checklistContext.contextFlags,
      proposals: encounter.proposals,
      transcript: encounter.transcript,
      additionalItems: encounter.checklistExtensions
    })
  });
}

const TRANSITIONS: Readonly<Record<EncounterState, readonly EncounterState[]>> = {
  created: ["consented"],
  consented: ["recording"],
  recording: ["processing"],
  processing: ["clinician_review"],
  clinician_review: ["signed"],
  signed: ["summary_approved"],
  summary_approved: ["shared"],
  shared: []
};

export function canTransition(from: EncounterState, to: EncounterState): boolean {
  return TRANSITIONS[from].includes(to);
}

function auditEvent(
  action: string,
  actorId: string,
  detail: Record<string, unknown>
): z.infer<typeof AuditEventSchema> {
  return {
    id: crypto.randomUUID(),
    action,
    actorId,
    occurredAt: new Date().toISOString(),
    detail
  };
}

export function resolveProposal(
  encounterInput: Encounter,
  command: {
    proposalId: string;
    value: string;
    actorId: string;
  }
): Encounter {
  const encounter = EncounterSchema.parse(encounterInput);
  if (encounter.state !== "clinician_review") {
    throw new Error("Proposals can only be resolved during clinician review.");
  }
  const proposal = encounter.proposals.find(item => item.id === command.proposalId);
  if (!proposal) throw new Error(`Unknown proposal: ${command.proposalId}`);
  if (!command.value.trim()) throw new Error("Resolved value cannot be empty.");

  return withEvaluatedChecklist({
    ...encounter,
    proposals: encounter.proposals.map(item =>
      item.id === command.proposalId
        ? {
            ...item,
            state: "clinician_entered",
            value: command.value.trim()
          }
        : item
    ),
    audit: [
      ...encounter.audit,
      auditEvent("proposal.resolved", command.actorId, {
        proposalId: command.proposalId,
        previousState: proposal.state
      })
    ]
  });
}

export function enterChecklistItem(
  encounterInput: Encounter,
  command: {
    itemId: string;
    value: string;
    actorId: string;
  }
): Encounter {
  const encounter = EncounterSchema.parse(encounterInput);
  if (encounter.state !== "clinician_review")
    throw new Error("Checklist items can only be entered during clinician review.");
  if (!command.value.trim()) throw new Error("Checklist value cannot be empty.");
  const definition = SYNTHETIC_PAC_TEMPLATE.items.find(
    current => current.id === command.itemId
  );
  if (!definition) throw new Error(`Unknown checklist item: ${command.itemId}`);
  const evaluated = withEvaluatedChecklist(encounter).checklist!;
  const current = evaluated.items.find(item => item.id === command.itemId);
  if (!current?.applicable)
    throw new Error(`Checklist item is not applicable: ${command.itemId}`);

  const proposal = {
    id: definition.id,
    label: definition.label,
    state: "clinician_entered" as const,
    value: command.value.trim(),
    sourceTurnIds: [] as string[],
    required: definition.required
  };
  return withEvaluatedChecklist({
    ...encounter,
    proposals: [
      ...encounter.proposals.filter(item => item.id !== command.itemId),
      proposal
    ],
    audit: [
      ...encounter.audit,
      auditEvent("checklist.item_entered", command.actorId, {
        itemId: command.itemId
      })
    ]
  });
}

export function deferChecklistItem(
  encounterInput: Encounter,
  command: {
    itemId: string;
    reason: string;
    actorId: string;
  }
): Encounter {
  const encounter = EncounterSchema.parse(encounterInput);
  if (encounter.state !== "clinician_review")
    throw new Error("Checklist items can only be deferred during clinician review.");
  if (!command.reason.trim()) throw new Error("A deferral reason is required.");
  const definition = SYNTHETIC_PAC_TEMPLATE.items.find(
    current => current.id === command.itemId
  );
  if (!definition) throw new Error(`Unknown checklist item: ${command.itemId}`);
  if (!definition.deferrable)
    throw new Error(`${definition.label} cannot be deferred.`);
  const current = withEvaluatedChecklist(encounter).checklist?.items.find(
    item => item.id === command.itemId
  );
  if (!current?.applicable)
    throw new Error(`Checklist item is not applicable: ${command.itemId}`);

  return withEvaluatedChecklist({
    ...encounter,
    proposals: [
      ...encounter.proposals.filter(item => item.id !== command.itemId),
      {
        id: definition.id,
        label: definition.label,
        state: "intentionally_skipped",
        value: command.reason.trim(),
        sourceTurnIds: [],
        required: definition.required
      }
    ],
    audit: [
      ...encounter.audit,
      auditEvent("checklist.item_deferred", command.actorId, {
        itemId: command.itemId,
        reason: command.reason.trim()
      })
    ]
  });
}

export function signEncounter(
  encounterInput: Encounter,
  command: {
    actorId: string;
    actorRole: "clinician" | "coordinator";
  }
): Encounter {
  const encounter = withEvaluatedChecklist(encounterInput);
  if (command.actorRole !== "clinician") {
    throw new Error("Only a clinician can sign a PAC note.");
  }
  if (!canTransition(encounter.state, "signed")) {
    throw new Error(`Encounter cannot be signed from state ${encounter.state}.`);
  }

  const unresolved = checklistBlockers(encounter.checklist!);
  if (unresolved.length) {
    throw new Error(
      `Resolve required fields before signing: ${unresolved
        .map(item => item.label)
        .join(", ")}`
    );
  }

  return withEvaluatedChecklist({
    ...encounter,
    state: "signed",
    audit: [
      ...encounter.audit,
      auditEvent("encounter.signed", command.actorId, {
        version: 1,
        proposalCount: encounter.proposals.length,
        checklistTemplateId: encounter.checklist?.templateId,
        checklistVersion: encounter.checklist?.version
      })
    ]
  });
}
