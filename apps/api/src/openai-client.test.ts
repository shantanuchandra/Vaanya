import { describe, expect, it, vi } from "vitest";
import { OpenAiPacClient } from "./openai-client";
import type { DiarizedSegment } from "./sarvam-client";

describe("OpenAiPacClient", () => {
  it("structures PAC-aware conversation turns without fabricating transcript text", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        turns: [
          {
            segmentId: "seg-1",
            speakerRole: "clinician",
            topic: "medications",
            uncertainty: false
          },
          {
            segmentId: "seg-2",
            speakerRole: "patient",
            topic: "medications",
            uncertainty: true
          }
        ]
      }
    });
    const client = new OpenAiPacClient("openai-key", { responses: { parse } });
    const segments: DiarizedSegment[] = [
      {
        id: "seg-1",
        speakerLabel: "Speaker 0",
        originalText: "Do you take regular medicines?",
        translatedText: "Do you take regular medicines?",
        startSeconds: 0,
        endSeconds: 1.8
      },
      {
        id: "seg-2",
        speakerLabel: "Speaker 1",
        originalText: "I take a blood thinner but forgot the name.",
        translatedText: "I take a blood thinner but forgot the name.",
        startSeconds: 2.1,
        endSeconds: 4.2
      }
    ];

    const turns = await client.structurePacConversation(segments);

    expect(turns).toEqual([
      {
        segmentId: "seg-1",
        speakerRole: "clinician",
        topic: "medications",
        uncertainty: false
      },
      {
        segmentId: "seg-2",
        speakerRole: "patient",
        topic: "medications",
        uncertainty: true
      }
    ]);
    const request = parse.mock.calls[0]?.[0];
    expect(request.model).toBe("gpt-5.6-sol");
    expect(JSON.stringify(request.input)).toContain(
      "synthetic pre-anesthetic check-up"
    );
    expect(JSON.stringify(turns)).not.toContain("blood thinner");
  });
});
