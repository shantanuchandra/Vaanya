import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type GoldenCase = {
  caseId: string;
  title: string;
  language: { path: string; primary: string; codeMixed: boolean };
  difficulty: string;
  conversation: Array<{
    turnId: string;
    speaker: string;
    language: string;
    text: string;
    confidence: number;
  }>;
  expectedPac: Record<
    string,
    { state: string; value: string; sourceTurnIds: string[] }
  >;
  requiredClarifications: Array<{ intent: string; prompt: string }>;
  prohibitedInferences: string[];
};

function findGoldenCasesPath() {
  const candidates = [
    resolve(process.cwd(), "test-cases/golden/golden-cases.jsonl"),
    resolve(process.cwd(), "../../test-cases/golden/golden-cases.jsonl")
  ];
  const selected = candidates.find(path => {
    try {
      readFileSync(path, "utf8");
      return true;
    } catch {
      return false;
    }
  });
  if (!selected) throw new Error("Golden-case corpus is unavailable.");
  return selected;
}

export function loadGoldenCases(): GoldenCase[] {
  return readFileSync(findGoldenCasesPath(), "utf8")
    .trim()
    .split("\n")
    .map(line => {
      const input = JSON.parse(line) as Record<string, any>;
      return {
        caseId: input.case_id,
        title: input.title,
        language: {
          path: input.language.path,
          primary: input.language.primary,
          codeMixed: input.language.code_mixed
        },
        difficulty: input.scenario_tags.difficulty,
        conversation: input.conversation.map((turn: Record<string, any>) => ({
          turnId: turn.turn_id,
          speaker: turn.speaker,
          language: turn.language,
          text: turn.text,
          confidence: turn.confidence
        })),
        expectedPac: Object.fromEntries(
          Object.entries(input.expected_pac).map(([key, raw]) => {
            const field = raw as Record<string, any>;
            return [
              key,
              {
                state: field.state,
                value: field.value,
                sourceTurnIds: field.source_turn_ids
              }
            ];
          })
        ),
        requiredClarifications: input.required_clarifications,
        prohibitedInferences: input.prohibited_inferences
      };
    });
}
