import { z } from "zod";

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

export const FieldProposalSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  state: FieldStateSchema,
  value: z.string(),
  sourceTurnIds: z.array(z.string()).min(1),
  required: z.boolean()
});

export const AuditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string(),
  occurredAt: z.string().datetime(),
  detail: z.record(z.string(), z.unknown())
});

export const EncounterSchema = z.object({
  id: z.string().min(1),
  patientReference: z.string().min(1),
  procedure: z.string().min(1),
  preferredLanguage: z.string().min(2),
  state: EncounterStateSchema,
  consentRecorded: z.boolean(),
  requiredFieldIds: z.array(z.string()),
  proposals: z.array(FieldProposalSchema),
  transcript: z.array(TranscriptTurnSchema),
  audit: z.array(AuditEventSchema)
});

export type Encounter = z.infer<typeof EncounterSchema>;

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

  return EncounterSchema.parse({
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

export function signEncounter(
  encounterInput: Encounter,
  command: {
    actorId: string;
    actorRole: "clinician" | "coordinator";
  }
): Encounter {
  const encounter = EncounterSchema.parse(encounterInput);
  if (command.actorRole !== "clinician") {
    throw new Error("Only a clinician can sign a PAC note.");
  }
  if (!canTransition(encounter.state, "signed")) {
    throw new Error(`Encounter cannot be signed from state ${encounter.state}.`);
  }

  const unresolved = encounter.proposals.filter(
    proposal =>
      encounter.requiredFieldIds.includes(proposal.id) &&
      ["uncertain", "missing"].includes(proposal.state)
  );
  if (unresolved.length) {
    throw new Error(
      `Resolve required fields before signing: ${unresolved
        .map(proposal => proposal.label)
        .join(", ")}`
    );
  }

  return EncounterSchema.parse({
    ...encounter,
    state: "signed",
    audit: [
      ...encounter.audit,
      auditEvent("encounter.signed", command.actorId, {
        version: 1,
        proposalCount: encounter.proposals.length
      })
    ]
  });
}
