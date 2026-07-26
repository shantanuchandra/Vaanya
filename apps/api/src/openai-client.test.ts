import { describe, expect, it, vi } from "vitest";
import { OpenAiPacClient } from "./openai-client";
import type { DiarizedSegment } from "./sarvam-client";

describe("OpenAiPacClient", () => {
  it("structures PAC-aware conversation turns without fabricating transcript text", async () => {
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        customerSummary:
          "Your pre-anaesthetic check-up was recorded for doctor review. Please bring your blood thinner strip because the exact name was not remembered.",
        turns: [
          {
            segmentId: "seg-1",
            speakerRole: "clinician",
            topic: "medications",
            uncertainty: false,
            evidencePhrases: ["regular medicines"]
          },
          {
            segmentId: "seg-2",
            speakerRole: "patient",
            topic: "medications",
            uncertainty: true,
            evidencePhrases: [
              "blood thinner",
              "forgot the name",
              "invented diagnosis"
            ]
          }
        ],
        checklistProposals: [
          {
            itemId: "medications",
            state: "uncertain",
            value: "Blood thinner reported; exact name not remembered.",
            sourceSegmentIds: ["seg-2"]
          },
          {
            itemId: "diagnosis",
            state: "captured",
            value: "ASA II",
            sourceSegmentIds: ["seg-2"]
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

    const result = await client.structurePacConversation(segments, [
      { itemId: "medications", label: "Current or recent medicines" }
    ]);

    expect(result.turns).toEqual([
      {
        segmentId: "seg-1",
        speakerRole: "clinician",
        topic: "medications",
        uncertainty: false,
        evidencePhrases: ["regular medicines"]
      },
      {
        segmentId: "seg-2",
        speakerRole: "patient",
        topic: "medications",
        uncertainty: true,
        evidencePhrases: ["blood thinner", "forgot the name"]
      }
    ]);
    const request = parse.mock.calls[0]?.[0];
    expect(request.model).toBe("gpt-5.6-sol");
    expect(JSON.stringify(request.input)).toContain(
      "synthetic pre-anesthetic check-up"
    );
    expect(result.customerSummary).toContain("doctor review");
    expect(result.turns[1]).not.toHaveProperty("translatedText");
    expect(result.checklistProposals).toEqual([
      expect.objectContaining({
        itemId: "medications",
        sourceSegmentIds: ["seg-2"]
      })
    ]);
    const userInput = JSON.parse(request.input[1].content);
    expect(userInput.checklistItems).toEqual([
      { itemId: "medications", label: "Current or recent medicines" }
    ]);
  });

  it("returns only literal PAC evidence phrases for a live transcript", async () => {
    const parse = vi.fn().mockResolvedValue({
      id: "run-highlight-1",
      output_parsed: {
        evidencePhrases: [
          "climb one flight of stairs",
          "become breathless",
          "not present in transcript"
        ]
      }
    });
    const client = new OpenAiPacClient("openai-key", { responses: { parse } });

    const phrases = await client.highlightEvidencePhrases(
      "I can climb one flight of stairs but become breathless."
    );

    expect(phrases).toEqual([
      "climb one flight of stairs",
      "become breathless"
    ]);
  });

  it("requests bounded checklist suggestions for an unknown procedure", async () => {
    const parse = vi.fn().mockResolvedValue({
      id: "run-unknown-1",
      output_parsed: {
        suggestions: [
          {
            categoryId: "history",
            question: "Was relevant reported history discussed?",
            rationale: "Supports procedure-specific documentation review."
          }
        ]
      }
    });
    const client = new OpenAiPacClient("openai-key", { responses: { parse } });

    const result = await client.suggestChecklistForUnknownProcedure({
      procedure: "Unlisted synthetic procedure",
      existingItems: [{ itemId: "medical_history", label: "Medical history" }],
      categoryIds: ["history"]
    });

    expect(result).toMatchObject({
      modelRunId: "run-unknown-1",
      suggestions: [expect.objectContaining({ categoryId: "history" })]
    });
    expect(JSON.stringify(parse.mock.calls[0]?.[0].input)).toContain(
      "Unlisted synthetic procedure"
    );
  });
});
