import { z } from "zod";

export const CHECKLIST_TEMPLATE_ID = "synthetic-pac";
export const CHECKLIST_VERSION = "synthetic-pac-v1";
export const CHECKLIST_VALIDATION_LABEL =
  "Synthetic checklist — clinician validation pending";

export const ProcedureFamilySchema = z.enum([
  "laparoscopic_abdominal",
  "hysterectomy",
  "knee_replacement",
  "upper_gi_endoscopy",
  "urological",
  "cataract",
  "breast",
  "generic"
]);
export type ProcedureFamily = z.infer<typeof ProcedureFamilySchema>;

export const ChecklistItemStatusSchema = z.enum([
  "answered",
  "uncertain",
  "missing",
  "deferred",
  "clinician_required",
  "not_applicable"
]);
export type ChecklistItemStatus = z.infer<typeof ChecklistItemStatusSchema>;

const ApplicabilityRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }),
  z.object({
    kind: z.literal("procedure_family"),
    families: z.array(ProcedureFamilySchema).min(1)
  }),
  z.object({
    kind: z.literal("clinician_selected_context"),
    flag: z.string().min(1)
  })
]);

export const ChecklistItemDefinitionSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  label: z.string().min(1),
  question: z.string().min(1),
  rationale: z.string().min(1),
  required: z.boolean(),
  authority: z.enum(["evidence_or_clinician", "clinician_only"]),
  severity: z.enum(["critical", "standard"]),
  deferrable: z.boolean(),
  applicability: ApplicabilityRuleSchema,
  clarificationGuidance: z.string().min(1).optional(),
  prohibition: z.string().min(1).optional()
});
export type ChecklistItemDefinition = z.infer<
  typeof ChecklistItemDefinitionSchema
>;

export const ChecklistCategoryDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  order: z.number().int().nonnegative()
});

export const ChecklistTemplateSchema = z.object({
  templateId: z.literal(CHECKLIST_TEMPLATE_ID),
  version: z.literal(CHECKLIST_VERSION),
  displayName: z.string().min(1),
  validationStatus: z.literal("synthetic"),
  validationLabel: z.literal(CHECKLIST_VALIDATION_LABEL),
  categories: z.array(ChecklistCategoryDefinitionSchema).min(1),
  items: z.array(ChecklistItemDefinitionSchema).min(1)
});
export type ChecklistTemplate = z.infer<typeof ChecklistTemplateSchema>;

export const ChecklistContextSchema = z.object({
  templateId: z.literal(CHECKLIST_TEMPLATE_ID),
  version: z.literal(CHECKLIST_VERSION),
  contextFlags: z.array(z.string())
});
export type ChecklistContext = z.infer<typeof ChecklistContextSchema>;

export const ChecklistSuggestionSchema = z.object({
  id: z.string().min(1),
  procedure: z.string().min(1),
  modelRunId: z.string().min(1),
  categoryId: z.string().min(1),
  question: z.string().min(1),
  rationale: z.string().min(1),
  required: z.literal(false),
  severity: z.literal("standard"),
  authority: z.literal("evidence_or_clinician"),
  deferrable: z.literal(true),
  approvalState: z.enum([
    "pending_clinician_review",
    "approved",
    "rejected"
  ]),
  decidedBy: z.string().min(1).optional(),
  decidedAt: z.string().datetime().optional()
});
export type ChecklistSuggestion = z.infer<typeof ChecklistSuggestionSchema>;

export const ChecklistLibraryReferenceSchema = z.object({
  normalizedProcedure: z.string().min(1),
  version: z.number().int().positive(),
  source: z.literal("clinician_reviewed_synthetic")
});

export const ChecklistLibraryVersionSchema = z.object({
  organizationId: z.string().min(1),
  normalizedProcedure: z.string().min(1),
  version: z.number().int().positive(),
  source: z.literal("clinician_reviewed_synthetic"),
  publishedBy: z.string().min(1),
  items: z.array(ChecklistItemDefinitionSchema).min(1)
});
export type ChecklistLibraryVersion = z.infer<
  typeof ChecklistLibraryVersionSchema
>;

export const EvaluatedChecklistItemSchema =
  ChecklistItemDefinitionSchema.extend({
    status: ChecklistItemStatusSchema,
    value: z.string(),
    sourceTurnIds: z.array(z.string()),
    applicable: z.boolean()
  });
export type EvaluatedChecklistItem = z.infer<
  typeof EvaluatedChecklistItemSchema
>;

export const EvaluatedChecklistCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  order: z.number().int().nonnegative(),
  answeredCount: z.number().int().nonnegative(),
  applicableCount: z.number().int().nonnegative(),
  blockingGapCount: z.number().int().nonnegative(),
  clinicianRequiredCount: z.number().int().nonnegative(),
  items: z.array(EvaluatedChecklistItemSchema)
});

export const EvaluatedChecklistSchema = z.object({
  templateId: z.literal(CHECKLIST_TEMPLATE_ID),
  version: z.literal(CHECKLIST_VERSION),
  validationLabel: z.literal(CHECKLIST_VALIDATION_LABEL),
  procedureFamily: ProcedureFamilySchema,
  genericProcedureCoverage: z.boolean(),
  answeredCount: z.number().int().nonnegative(),
  applicableCount: z.number().int().nonnegative(),
  blockingGapCount: z.number().int().nonnegative(),
  clinicianRequiredCount: z.number().int().nonnegative(),
  readyForSignoff: z.boolean(),
  categories: z.array(EvaluatedChecklistCategorySchema),
  items: z.array(EvaluatedChecklistItemSchema)
});
export type EvaluatedChecklist = z.infer<typeof EvaluatedChecklistSchema>;

type ProposalInput = {
  id: string;
  state:
    | "captured"
    | "uncertain"
    | "missing"
    | "intentionally_skipped"
    | "clinician_entered";
  value: string;
  sourceTurnIds: string[];
};

export type ChecklistEvaluationInput = {
  procedure: string;
  contextFlags: string[];
  proposals: ProposalInput[];
  transcript: Array<{ id: string }>;
  additionalItems?: ChecklistItemDefinition[];
};

const always = { kind: "always" as const };
const forFamilies = (...families: ProcedureFamily[]) => ({
  kind: "procedure_family" as const,
  families
});
const withContext = (flag: string) => ({
  kind: "clinician_selected_context" as const,
  flag
});

const categories = [
  ["encounter", "Encounter and consent", "Identity, procedure and consent context"],
  ["history", "Medical history", "Relevant reported history"],
  ["medicines", "Medicines", "Current and recent medicine evidence"],
  ["allergies", "Allergies", "Allergy substance and reaction evidence"],
  ["previous_anesthesia", "Previous anesthesia", "Prior exposure and recalled complications"],
  ["fasting", "Fasting and aspiration history", "Reported intake, timing and related history"],
  ["documents", "Investigations and documents", "Mentioned or missing records"],
  ["examination", "Examination", "Clinician-entered findings only"],
  ["procedure_specific", "Procedure-specific documentation", "Synthetic procedure coverage prompts"],
  ["conclusion", "Open items and clinician conclusion", "Explicit open items and clinician sign-off content"]
].map(([id, label, description], order) => ({
  id,
  label,
  description,
  order
}));

const item = (
  definition: ChecklistItemDefinition
): ChecklistItemDefinition => definition;

const items: ChecklistItemDefinition[] = [
  item({
    id: "identity",
    categoryId: "encounter",
    label: "Patient identity",
    question: "Was the patient identity explicitly confirmed?",
    rationale: "Encounter identity is required for the documentation record.",
    required: true,
    authority: "clinician_only",
    severity: "critical",
    deferrable: false,
    applicability: always
  }),
  item({
    id: "procedure",
    categoryId: "encounter",
    label: "Planned procedure",
    question: "Was the planned procedure explicitly confirmed?",
    rationale: "The clinician-selected procedure determines checklist coverage.",
    required: true,
    authority: "clinician_only",
    severity: "critical",
    deferrable: false,
    applicability: always
  }),
  item({
    id: "consent",
    categoryId: "encounter",
    label: "Recording consent",
    question: "Was consent for recording and transcription documented?",
    rationale: "Consent must be explicit before processing the conversation.",
    required: true,
    authority: "clinician_only",
    severity: "critical",
    deferrable: false,
    applicability: always
  }),
  item({
    id: "medical_history",
    categoryId: "history",
    label: "Relevant medical history",
    question: "What relevant medical history was reported?",
    rationale: "Reported history supports a complete clinician review.",
    required: true,
    authority: "evidence_or_clinician",
    severity: "standard",
    deferrable: true,
    applicability: always
  }),
  item({
    id: "medications",
    categoryId: "medicines",
    label: "Current or recent medicines",
    question: "Which current or recent medicines and last use were reported?",
    rationale: "Medicine ambiguity must remain visible for reconciliation.",
    required: true,
    authority: "evidence_or_clinician",
    severity: "critical",
    deferrable: true,
    applicability: always,
    clarificationGuidance:
      "Ask for the medicine strip, prescription, caregiver or record.",
    prohibition:
      "Do not infer medicine identity, dose, frequency or instructions."
  }),
  item({
    id: "allergies",
    categoryId: "allergies",
    label: "Allergy history",
    question: "What allergy substance and reaction were reported?",
    rationale: "An unknown reaction must remain distinct from no allergy.",
    required: true,
    authority: "evidence_or_clinician",
    severity: "critical",
    deferrable: true,
    applicability: always,
    prohibition: "Do not convert absent evidence into no known allergy."
  }),
  item({
    id: "previous_anesthesia",
    categoryId: "previous_anesthesia",
    label: "Previous anesthesia",
    question: "Was prior anesthesia and any recalled complication discussed?",
    rationale: "Remote or forgotten events require explicit documentation.",
    required: true,
    authority: "evidence_or_clinician",
    severity: "critical",
    deferrable: true,
    applicability: always
  }),
  item({
    id: "fasting",
    categoryId: "fasting",
    label: "Reported fasting intake and time",
    question: "What intake and time did the patient report?",
    rationale: "The statement is recorded; the clinician determines significance.",
    required: true,
    authority: "evidence_or_clinician",
    severity: "critical",
    deferrable: true,
    applicability: always,
    prohibition: "Do not approve fasting or give intake instructions."
  }),
  item({
    id: "documents",
    categoryId: "documents",
    label: "Investigations or documents",
    question: "Which reports, prescriptions or medicine strips were mentioned?",
    rationale: "Mentioned and missing documents remain visible without interpretation.",
    required: false,
    authority: "evidence_or_clinician",
    severity: "standard",
    deferrable: true,
    applicability: always
  }),
  item({
    id: "examination",
    categoryId: "examination",
    label: "Clinician examination",
    question: "Has the clinician entered the local examination findings?",
    rationale: "The prototype must not originate examination findings.",
    required: true,
    authority: "clinician_only",
    severity: "critical",
    deferrable: false,
    applicability: always
  }),
  item({
    id: "pregnancy_context",
    categoryId: "procedure_specific",
    label: "Pregnancy-related documentation",
    question: "Was the explicitly selected pregnancy context documented?",
    rationale: "This appears only after explicit clinician selection.",
    required: true,
    authority: "evidence_or_clinician",
    severity: "critical",
    deferrable: true,
    applicability: withContext("pregnancy_question_applicable")
  }),
  item({
    id: "abdominal_history",
    categoryId: "procedure_specific",
    label: "Relevant abdominal procedure history",
    question: "Was relevant prior abdominal procedure history discussed?",
    rationale: "Synthetic modifier for laparoscopic abdominal documentation.",
    required: false,
    authority: "evidence_or_clinician",
    severity: "standard",
    deferrable: true,
    applicability: forFamilies("laparoscopic_abdominal")
  }),
  item({
    id: "bleeding_history",
    categoryId: "procedure_specific",
    label: "Bleeding-history evidence",
    question: "Was reported bleeding history documented?",
    rationale: "Synthetic modifier for hysterectomy documentation.",
    required: true,
    authority: "evidence_or_clinician",
    severity: "standard",
    deferrable: true,
    applicability: forFamilies("hysterectomy")
  }),
  item({
    id: "functional_history",
    categoryId: "procedure_specific",
    label: "Functional-history discussion",
    question: "Was relevant functional history discussed?",
    rationale: "Synthetic modifier for knee replacement documentation.",
    required: false,
    authority: "evidence_or_clinician",
    severity: "standard",
    deferrable: true,
    applicability: forFamilies("knee_replacement")
  }),
  item({
    id: "reflux_history",
    categoryId: "procedure_specific",
    label: "Reflux or aspiration-history discussion",
    question: "Was reported reflux or aspiration history discussed?",
    rationale: "Synthetic modifier for upper GI endoscopy documentation.",
    required: false,
    authority: "evidence_or_clinician",
    severity: "standard",
    deferrable: true,
    applicability: forFamilies("upper_gi_endoscopy")
  }),
  item({
    id: "open_items",
    categoryId: "conclusion",
    label: "Open items",
    question: "Are unresolved or deferred documentation items explicit?",
    rationale: "Unknown and missing information must remain visible.",
    required: true,
    authority: "clinician_only",
    severity: "standard",
    deferrable: true,
    applicability: always
  }),
  item({
    id: "clinician_conclusion",
    categoryId: "conclusion",
    label: "Clinician conclusion",
    question: "Has the clinician entered the local conclusion?",
    rationale: "Only the reviewing clinician may originate and sign this content.",
    required: true,
    authority: "clinician_only",
    severity: "critical",
    deferrable: false,
    applicability: always
  })
];

export const SYNTHETIC_PAC_TEMPLATE = ChecklistTemplateSchema.parse({
  templateId: CHECKLIST_TEMPLATE_ID,
  version: CHECKLIST_VERSION,
  displayName: "Synthetic PAC completeness checklist",
  validationStatus: "synthetic",
  validationLabel: CHECKLIST_VALIDATION_LABEL,
  categories,
  items
});

export function normalizeProcedureFamily(procedure: string): ProcedureFamily {
  const value = procedure.trim().toLowerCase();
  if (/hysterectomy/.test(value)) return "hysterectomy";
  if (/laparoscop|cholecyst|hernia/.test(value))
    return "laparoscopic_abdominal";
  if (/knee|arthroplast/.test(value)) return "knee_replacement";
  if (/upper\s*gi|endoscop/.test(value)) return "upper_gi_endoscopy";
  if (/urolog|transurethral/.test(value)) return "urological";
  if (/cataract/.test(value)) return "cataract";
  if (/breast/.test(value)) return "breast";
  return "generic";
}

function applies(
  definition: ChecklistItemDefinition,
  family: ProcedureFamily,
  flags: ReadonlySet<string>
): boolean {
  const rule = definition.applicability;
  if (rule.kind === "always") return true;
  if (rule.kind === "procedure_family") return rule.families.includes(family);
  return flags.has(rule.flag);
}

function proposalStatus(
  definition: ChecklistItemDefinition,
  proposal: ProposalInput | undefined,
  transcriptIds: ReadonlySet<string>
): ChecklistItemStatus {
  if (!proposal)
    return definition.authority === "clinician_only"
      ? "clinician_required"
      : "missing";
  if (proposal.state === "clinician_entered") return "answered";
  if (proposal.state === "intentionally_skipped") return "deferred";
  if (proposal.state === "missing") return "missing";
  const hasValidSource = proposal.sourceTurnIds.some(id =>
    transcriptIds.has(id)
  );
  if (!hasValidSource) return "uncertain";
  return proposal.state === "captured" ? "answered" : "uncertain";
}

export function evaluateChecklist(
  input: ChecklistEvaluationInput
): EvaluatedChecklist {
  const procedureFamily = normalizeProcedureFamily(input.procedure);
  const flags = new Set(input.contextFlags);
  const transcriptIds = new Set(input.transcript.map(turn => turn.id));
  const proposals = new Map(input.proposals.map(proposal => [proposal.id, proposal]));

  const definitions = [
    ...SYNTHETIC_PAC_TEMPLATE.items,
    ...(input.additionalItems ?? []).filter(
      additional =>
        SYNTHETIC_PAC_TEMPLATE.categories.some(
          category => category.id === additional.categoryId
        ) &&
        !SYNTHETIC_PAC_TEMPLATE.items.some(
          existing => existing.id === additional.id
        )
    )
  ];
  const evaluatedItems: EvaluatedChecklistItem[] =
    definitions.map(definition => {
      const applicable = applies(definition, procedureFamily, flags);
      const proposal = proposals.get(definition.id);
      return {
        ...definition,
        applicable,
        status: applicable
          ? proposalStatus(definition, proposal, transcriptIds)
          : "not_applicable",
        value: applicable ? proposal?.value ?? "" : "",
        sourceTurnIds: applicable ? proposal?.sourceTurnIds ?? [] : []
      };
    });

  const evaluatedCategories = SYNTHETIC_PAC_TEMPLATE.categories.map(category => {
    const categoryItems = evaluatedItems.filter(
      current => current.categoryId === category.id
    );
    const applicableItems = categoryItems.filter(current => current.applicable);
    const blockers = applicableItems.filter(
      current =>
        current.required &&
        ["uncertain", "missing", "clinician_required"].includes(current.status)
    );
    return {
      ...category,
      answeredCount: applicableItems.filter(
        current => current.status === "answered" || current.status === "deferred"
      ).length,
      applicableCount: applicableItems.length,
      blockingGapCount: blockers.length,
      clinicianRequiredCount: applicableItems.filter(
        current => current.status === "clinician_required"
      ).length,
      items: categoryItems
    };
  });

  const applicableItems = evaluatedItems.filter(current => current.applicable);
  const blockers = evaluatedItems.filter(
    current =>
      current.required &&
      ["uncertain", "missing", "clinician_required"].includes(current.status)
  );
  return EvaluatedChecklistSchema.parse({
    templateId: CHECKLIST_TEMPLATE_ID,
    version: CHECKLIST_VERSION,
    validationLabel: CHECKLIST_VALIDATION_LABEL,
    procedureFamily,
    genericProcedureCoverage: procedureFamily === "generic",
    answeredCount: applicableItems.filter(
      current => current.status === "answered" || current.status === "deferred"
    ).length,
    applicableCount: applicableItems.length,
    blockingGapCount: blockers.length,
    clinicianRequiredCount: applicableItems.filter(
      current => current.status === "clinician_required"
    ).length,
    readyForSignoff: blockers.length === 0,
    categories: evaluatedCategories,
    items: evaluatedItems
  });
}

export function checklistBlockers(
  checklist: EvaluatedChecklist
): EvaluatedChecklistItem[] {
  return checklist.items.filter(
    current =>
      current.required &&
      ["uncertain", "missing", "clinician_required"].includes(current.status)
  );
}
