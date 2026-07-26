import type {
  ChecklistLibraryVersion,
  ChecklistSuggestion as ContractChecklistSuggestion
} from "@vaanaya/contracts";

export type UnknownProcedureSuggestionInput = {
  categoryId: string;
  question: string;
  rationale: string;
};

export type ChecklistSuggestion = ContractChecklistSuggestion;

const PROHIBITED =
  /\b(diagnos|asa\s*(grade|class)?|fitness|fit for|anesthetic technique|anaesthetic technique|order|investigation|test required|start|stop|hold|discontinue|fasting instruction)\b/i;

function safeText(value: string): boolean {
  return Boolean(value.trim()) && !PROHIBITED.test(value);
}

export function normalizeProcedureLibraryKey(procedure: string): string {
  return procedure.trim().toLowerCase().replace(/\s+/g, " ");
}

export function sanitizeUnknownProcedureSuggestions(input: {
  procedure: string;
  modelRunId: string;
  categoryIds: string[];
  suggestions: UnknownProcedureSuggestionInput[];
}): ChecklistSuggestion[] {
  const allowedCategories = new Set(input.categoryIds);
  return input.suggestions
    .filter(
      suggestion =>
        allowedCategories.has(suggestion.categoryId) &&
        safeText(suggestion.question) &&
        safeText(suggestion.rationale)
    )
    .slice(0, 5)
    .map((suggestion, index) => ({
      id: `suggestion-${input.modelRunId}-${index + 1}`,
      procedure: input.procedure.trim(),
      modelRunId: input.modelRunId,
      categoryId: suggestion.categoryId,
      question: suggestion.question.trim(),
      rationale: suggestion.rationale.trim(),
      required: false,
      severity: "standard",
      authority: "evidence_or_clinician",
      deferrable: true,
      approvalState: "pending_clinician_review"
    }));
}

export function decideChecklistSuggestion(input: {
  suggestions: ChecklistSuggestion[];
  suggestionId: string;
  decision: "approved" | "rejected";
  actorId: string;
}): ChecklistSuggestion[] {
  if (!input.suggestions.some(item => item.id === input.suggestionId))
    throw new Error(`Unknown checklist suggestion: ${input.suggestionId}`);
  return input.suggestions.map(item =>
    item.id === input.suggestionId
      ? {
          ...item,
          approvalState: input.decision,
          decidedBy: input.actorId,
          decidedAt: new Date().toISOString()
        }
      : item
  );
}

export function buildPublishedChecklistVersion(input: {
  organizationId: string;
  procedure: string;
  suggestions: ChecklistSuggestion[];
  latestVersion: number;
  actorId: string;
}): ChecklistLibraryVersion {
  if (
    input.suggestions.some(
      item => item.approvalState === "pending_clinician_review"
    )
  )
    throw new Error(
      "Pending checklist suggestions need a decision before publishing."
    );
  const approved = input.suggestions.filter(
    item => item.approvalState === "approved"
  );
  if (approved.length === 0)
    throw new Error("At least one approved checklist suggestion is required.");
  return {
    organizationId: input.organizationId,
    normalizedProcedure: normalizeProcedureLibraryKey(input.procedure),
    version: input.latestVersion + 1,
    source: "clinician_reviewed_synthetic" as const,
    publishedBy: input.actorId,
    items: approved.map(item => ({
      id: item.id,
      categoryId: item.categoryId,
      label: item.question,
      question: item.question,
      rationale: item.rationale,
      required: false as const,
      severity: "standard" as const,
      authority: "evidence_or_clinician" as const,
      deferrable: true as const,
      applicability: { kind: "always" as const }
    }))
  };
}
