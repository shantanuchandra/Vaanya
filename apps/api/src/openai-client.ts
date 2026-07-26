import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { DiarizedSegment } from "./sarvam-client";

const PacConversationTurnSchema = z.object({
  segmentId: z.string().min(1),
  speakerRole: z.enum(["clinician", "patient", "unknown"]),
  topic: z.enum([
    "medications",
    "allergies",
    "prior_anesthesia",
    "fasting",
    "history",
    "administrative",
    "other"
  ]),
  uncertainty: z.boolean()
});

const PacChecklistProposalSchema = z.object({
  itemId: z.string().min(1),
  state: z.enum(["captured", "uncertain"]),
  value: z.string().min(1),
  sourceSegmentIds: z.array(z.string()).min(1)
});

const PacConversationSchema = z.object({
  customerSummary: z.string().min(1),
  turns: z.array(PacConversationTurnSchema),
  checklistProposals: z.array(PacChecklistProposalSchema)
});

export type PacConversationTurn = z.infer<typeof PacConversationTurnSchema>;
export type PacConversationStructure = z.infer<typeof PacConversationSchema>;

const UnknownProcedureSuggestionResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        question: z.string().min(1),
        rationale: z.string().min(1)
      })
    )
    .max(5)
});

type ResponsesParser = {
  responses: {
    parse(input: unknown): Promise<{ id?: string; output_parsed?: unknown }>;
  };
};

export class OpenAiPacClient {
  readonly #client: ResponsesParser;

  constructor(apiKey: string, client?: ResponsesParser) {
    this.#client = client ?? new OpenAI({ apiKey });
  }

  async structurePacConversation(
    segments: DiarizedSegment[],
    checklistItems: Array<{ itemId: string; label: string }> = []
  ): Promise<PacConversationStructure> {
    const response = await this.#client.responses.parse({
      model: "gpt-5.6-sol",
      input: [
        {
          role: "system",
          content:
            "You organize a synthetic pre-anesthetic check-up conversation for clinician-supervised documentation and draft a simple customer-facing summary. Use only the supplied Sarvam diarized segment IDs and text. Checklist proposal IDs must come from the supplied checklistItems. Applicability and requirement level are controlled by the server. Do not diagnose, assign ASA grade, identify an unknown medicine, provide medication instructions, approve fasting, or infer clinical facts not stated. Speaker role can be unknown. The customerSummary must be simple, non-alarming, and explicitly say the note is for doctor review."
        },
        {
          role: "user",
          content: JSON.stringify({
            context: "synthetic PAC recording",
            checklistItems,
            segments: segments.map(segment => ({
              segmentId: segment.id,
              speakerLabel: segment.speakerLabel,
              translatedText: segment.translatedText,
              startSeconds: segment.startSeconds,
              endSeconds: segment.endSeconds
            }))
          })
        }
      ],
      text: {
        format: zodTextFormat(PacConversationSchema, "pac_conversation_turns")
      }
    });
    const parsed = PacConversationSchema.parse(response.output_parsed);
    const segmentIds = new Set(segments.map(segment => segment.id));
    const checklistItemIds = new Set(checklistItems.map(item => item.itemId));
    return {
      ...parsed,
      turns: parsed.turns.filter(turn => segmentIds.has(turn.segmentId)),
      checklistProposals: parsed.checklistProposals.filter(
        proposal =>
          checklistItemIds.has(proposal.itemId) &&
          proposal.sourceSegmentIds.every(id => segmentIds.has(id))
      )
    };
  }

  async suggestChecklistForUnknownProcedure(input: {
    procedure: string;
    existingItems: Array<{ itemId: string; label: string }>;
    categoryIds: string[];
  }) {
    const response = await this.#client.responses.parse({
      model: "gpt-5.6-sol",
      input: [
        {
          role: "system",
          content:
            "Suggest at most five neutral documentation questions for an unknown synthetic pre-anesthetic procedure. Use only supplied category IDs. Do not diagnose, grade ASA, assess fitness, recommend an anesthetic technique, order investigations, or give medicine or fasting instructions. A clinician will review every suggestion before it can become active."
        },
        {
          role: "user",
          content: JSON.stringify(input)
        }
      ],
      text: {
        format: zodTextFormat(
          UnknownProcedureSuggestionResponseSchema,
          "unknown_procedure_checklist_suggestions"
        )
      }
    });
    const parsed = UnknownProcedureSuggestionResponseSchema.parse(
      response.output_parsed
    );
    return {
      modelRunId: response.id ?? crypto.randomUUID(),
      suggestions: parsed.suggestions
    };
  }
}
