import { readFile } from "node:fs/promises";
import {
  EncounterSchema,
  resolveProposal,
  signEncounter,
  withEvaluatedChecklist,
  type Encounter
} from "@vaanaya/contracts";

type CorpusCase = {
  case_id: string;
  title: string;
  language: { primary: string; path: string };
  patient_profile: { procedure_context: string };
  scenario_tags: { family: string; difficulty: string };
  conversation: Array<{
    turn_id: string;
    speaker: "clinician" | "patient" | "caregiver";
    language: string;
    text: string;
    confidence: number;
  }>;
  expected_pac: Record<
    string,
    {
      state: "captured" | "uncertain" | "missing" | "intentionally_skipped";
      value: string;
      source_turn_ids: string[];
    }
  >;
};

const selectedFamilies = new Set([
  "antithrombotic_colloquial",
  "fasting_readiness",
  "prior_anesthesia"
]);
const corpus = (await readFile(
  new URL("../test-cases/golden/golden-cases.jsonl", import.meta.url),
  "utf8"
))
  .trim()
  .split("\n")
  .map(line => JSON.parse(line) as CorpusCase)
  .filter(item => selectedFamilies.has(item.scenario_tags.family));

if (corpus.length !== 3)
  throw new Error(`Expected three simulation cases, received ${corpus.length}.`);

function toEncounter(testCase: CorpusCase): Encounter {
  const checklistIdByCorpusField: Record<string, string> = {
    fasting_readiness: "fasting",
    prior_anesthesia_history: "previous_anesthesia"
  };
  const scenarioProposals = Object.entries(testCase.expected_pac).map(
    ([field, expectation]) => ({
      id: checklistIdByCorpusField[field] ?? field,
      label: field.replaceAll("_", " "),
      state: expectation.state,
      value: expectation.value,
      sourceTurnIds: expectation.source_turn_ids,
      required: true
    })
  );
  const baselineIds = [
    "identity",
    "procedure",
    "consent",
    "medical_history",
    "medications",
    "allergies",
    "previous_anesthesia",
    "fasting",
    "examination",
    "open_items",
    "clinician_conclusion"
  ];
  const scenarioIds = new Set(scenarioProposals.map(proposal => proposal.id));
  const proposals = [
    ...baselineIds
      .filter(id => !scenarioIds.has(id))
      .map(id => ({
        id,
        label: id.replaceAll("_", " "),
        state: "clinician_entered" as const,
        value: `Clinician reviewed ${id.replaceAll("_", " ")}.`,
        sourceTurnIds: [],
        required: true
      })),
    ...scenarioProposals
  ];
  return withEvaluatedChecklist(EncounterSchema.parse({
    id: testCase.case_id,
    patientReference: testCase.case_id,
    procedure: testCase.patient_profile.procedure_context,
    preferredLanguage: testCase.language.primary,
    state: "clinician_review",
    consentRecorded: true,
    requiredFieldIds: proposals.map(proposal => proposal.id),
    proposals,
    transcript: testCase.conversation.map((turn, index) => ({
      id: turn.turn_id,
      speaker: turn.speaker,
      language: turn.language,
      original: turn.text,
      translation: turn.text,
      confidence: turn.confidence,
      offsetSeconds: index * 8
    })),
    audit: []
  }));
}

const results = corpus.map(testCase => {
  let encounter = toEncounter(testCase);
  const initiallyBlocked = encounter.proposals.some(
    proposal =>
      proposal.required && ["uncertain", "missing"].includes(proposal.state)
  );
  let prematureSignBlocked = false;
  try {
    signEncounter(encounter, {
      actorId: "simulation-clinician",
      actorRole: "clinician"
    });
  } catch {
    prematureSignBlocked = true;
  }

  const sourceLinksBefore = encounter.proposals.flatMap(
    proposal => proposal.sourceTurnIds
  );
  for (const proposal of encounter.proposals.filter(item =>
    ["uncertain", "missing"].includes(item.state)
  )) {
    encounter = resolveProposal(encounter, {
      proposalId: proposal.id,
      value: `Clinician reviewed the source and documented: ${proposal.value}`,
      actorId: "simulation-clinician"
    });
  }
  encounter = signEncounter(encounter, {
    actorId: "simulation-clinician",
    actorRole: "clinician"
  });
  const sourceLinksAfter = encounter.proposals.flatMap(
    proposal => proposal.sourceTurnIds
  );
  const serialized = JSON.stringify(encounter);

  return {
    caseId: testCase.case_id,
    title: testCase.title,
    family: testCase.scenario_tags.family,
    difficulty: testCase.scenario_tags.difficulty,
    languagePath: testCase.language.path,
    initiallyBlocked,
    prematureSignBlocked,
    signGateCorrect: initiallyBlocked
      ? prematureSignBlocked
      : !prematureSignBlocked,
    finalState: encounter.state,
    sourceLinksPreserved:
      JSON.stringify(sourceLinksBefore) === JSON.stringify(sourceLinksAfter),
    prohibitedDrugInferenceAbsent: !/aspirin|clopidogrel|warfarin/i.test(
      serialized
    ),
    auditEvents: encounter.audit.length
  };
});

const allPassed = results.every(
  result =>
    result.signGateCorrect &&
    result.finalState === "signed" &&
    result.sourceLinksPreserved &&
    result.prohibitedDrugInferenceAbsent
);

console.log(JSON.stringify({ allPassed, results }, null, 2));
if (!allPassed) process.exitCode = 1;
