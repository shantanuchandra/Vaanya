import type { FieldState } from "@vaanaya/contracts";

type ApplicableItem = {
  id: string;
  label: string;
  required: boolean;
  authority: "evidence_or_clinician" | "clinician_only";
};

type ModelItem = {
  itemId: string;
  state: Extract<FieldState, "captured" | "uncertain">;
  value: string;
  sourceTurnIds: string[];
};

export function materializeChecklistProposals(input: {
  applicableItems: ApplicableItem[];
  modelItems: ModelItem[];
  transcript: Array<{ id: string }>;
}) {
  const transcriptIds = new Set(input.transcript.map(turn => turn.id));
  const allowedModelItems = new Map(
    input.modelItems
      .filter(model => input.applicableItems.some(item => item.id === model.itemId))
      .map(model => [model.itemId, model])
  );

  return input.applicableItems
    .filter(item => item.authority === "evidence_or_clinician")
    .map(item => {
      const model = allowedModelItems.get(item.id);
      const sourceTurnIds =
        model?.sourceTurnIds.filter(id => transcriptIds.has(id)) ?? [];
      if (!model || sourceTurnIds.length === 0) {
        return {
          id: item.id,
          label: item.label,
          required: item.required,
          state: "missing" as const,
          value: "No source-linked answer was captured.",
          sourceTurnIds: [] as string[]
        };
      }
      return {
        id: item.id,
        label: item.label,
        required: item.required,
        state: model.state,
        value: model.value.trim(),
        sourceTurnIds
      };
    });
}
