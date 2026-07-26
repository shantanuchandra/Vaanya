import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCorpus } from '../lib/contracts.mjs';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(CURRENT_DIR, '..');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'templates', 'scenario_templates.json');
const OUTPUT_PATH = path.join(ROOT_DIR, 'corpus', 'vaanaya-pac-v1.jsonl');

const templates = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));

const LANGUAGE_PLAN = [
  ['hi-hinglish', 700, 'hi-IN', true],
  ['kn-kanglish', 150, 'kn-IN', true],
  ['en', 150, 'en-IN', false]
];

const AGE_BANDS = ['adult-18-44', 'adult-45-64', 'adult-65-plus'];
const PROCEDURES = [
  'elective abdominal procedure',
  'elective orthopedic procedure',
  'elective ophthalmic procedure',
  'elective gynecologic procedure',
  'elective general-surgery procedure'
];
const BASE_PROHIBITIONS = [
  'assign_asa_class',
  'determine_anesthetic_fitness',
  'autonomous_signoff',
  'diagnose_condition',
  'select_anesthetic_plan'
];

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function choose(values, random) {
  return values[Math.floor(random() * values.length)];
}

function buildCase({ index, languagePath, primary, codeMixed, template, random }) {
  const conversation = template.utterances.map((utterance, turnIndex) => ({
    turn_id: `t${turnIndex + 1}`,
    speaker: utterance.speaker,
    language: primary,
    text: choose(utterance.text[languagePath], random),
    confidence: utterance.confidence ?? Number((0.88 + random() * 0.11).toFixed(2))
  }));
  const sourceTurnIds = template.source_turn_numbers.map(number => `t${number}`);
  const uncertainties = template.uncertainty_field
    ? [
        {
          field: template.uncertainty_field,
          reason: template.uncertainty_reason
        }
      ]
    : [];

  return {
    case_id: `PAC-SYN-${String(index).padStart(4, '0')}`,
    schema_version: '1.0.0',
    title: template.title,
    language: {
      path: languagePath,
      primary,
      code_mixed: codeMixed
    },
    patient_profile: {
      synthetic: true,
      age_band: choose(AGE_BANDS, random),
      procedure_context: choose(PROCEDURES, random),
      communication_factors: template.communication_factors
    },
    scenario_tags: {
      family: template.family,
      ambiguity_types: template.ambiguity_types,
      difficulty: template.difficulty,
      workflow_stages: template.family === 'session_continuity'
        ? ['conversation', 'review', 'handoff']
        : ['conversation', 'review']
    },
    conversation,
    hidden_facts: {
      template_truth: template.expected_value,
      synthetic_only: true
    },
    expected_pac: {
      [template.expected_field]: {
        state: template.expected_state,
        value: template.expected_value,
        source_turn_ids: sourceTurnIds
      }
    },
    source_expectations: [
      {
        field: template.expected_field,
        turn_ids: sourceTurnIds
      }
    ],
    uncertainties,
    required_clarifications: [
      {
        intent: template.clarification_intent,
        prompt: template.clarification_prompt
      }
    ],
    prohibited_inferences: [
      ...new Set([...BASE_PROHIBITIONS, ...(template.extra_prohibitions ?? [])])
    ],
    expected_workflow: {
      clinician_review_required: true,
      explicit_signoff_required: true,
      autonomous_signoff_allowed: false,
      patient_summary_from_approved_content_only: true
    },
    assertions: [
      {
        type: 'field_state',
        path: `expected_pac.${template.expected_field}.state`,
        expected: template.expected_state
      }
    ],
    provenance: {
      template_id: template.template_id,
      generator_version: '1.0.0',
      evidence_classification: [
        'synthetic_assumption',
        ...(new Set([
          'medication_identity',
          'antithrombotic_colloquial',
          'allergy_reaction',
          'prior_anesthesia',
          'fasting_readiness',
          'comorbidity_history',
          'conflicting_sources'
        ]).has(template.family)
          ? ['published_evidence']
          : ['clinician_observation'])
      ]
    },
    clinical_review: {
      status: 'unreviewed',
      reviewer_role: 'anesthesiologist',
      notes: ''
    }
  };
}

export function generateCorpus({ seed = 20260726 } = {}) {
  const random = createPrng(seed);
  const records = [];
  let index = 1;

  for (const [languagePath, count, primary, codeMixed] of LANGUAGE_PLAN) {
    for (let languageIndex = 0; languageIndex < count; languageIndex += 1) {
      const template = templates[(languageIndex + Math.floor(random() * templates.length)) % templates.length];
      records.push(
        buildCase({
          index,
          languagePath,
          primary,
          codeMixed,
          template,
          random
        })
      );
      index += 1;
    }
  }

  return records;
}

function writeCorpus() {
  const records = generateCorpus();
  const errors = validateCorpus(records);
  if (errors.length) {
    throw new Error(`Generated corpus is invalid:\n${errors.slice(0, 50).join('\n')}`);
  }
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  process.stdout.write(`Generated ${records.length} cases at ${OUTPUT_PATH}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeCorpus();
}

