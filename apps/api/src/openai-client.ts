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

const PacConversationSchema = z.object({
  turns: z.array(PacConversationTurnSchema)
});

export type PacConversationTurn = z.infer<typeof PacConversationTurnSchema>;

type ResponsesParser = {
  responses: {
    parse(input: unknown): Promise<{ output_parsed?: unknown }>;
  };
};

export class OpenAiPacClient {
  readonly #client: ResponsesParser;

  constructor(apiKey: string, client?: ResponsesParser) {
    this.#client = client ?? new OpenAI({ apiKey });
  }

  async structurePacConversation(
    segments: DiarizedSegment[]
  ): Promise<PacConversationTurn[]> {
    const response = await this.#client.responses.parse({
      model: "gpt-5.6-sol",
      input: [
        {
          role: "system",
          content:
            "You organize a synthetic pre-anesthetic check-up conversation for clinician-supervised documentation. Use only the supplied Sarvam diarized segment IDs and text. Do not diagnose, assign ASA grade, identify an unknown medicine, provide medication instructions, approve fasting, or infer clinical facts not stated. Speaker role can be unknown."
        },
        {
          role: "user",
          content: JSON.stringify({
            context: "synthetic PAC recording",
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
    return parsed.turns.filter(turn => segmentIds.has(turn.segmentId));
  }
}
