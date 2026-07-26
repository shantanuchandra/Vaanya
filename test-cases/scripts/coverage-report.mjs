import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJsonl } from './validate-corpus.mjs';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(CURRENT_DIR, '..');
const CORPUS_PATH = path.join(ROOT_DIR, 'corpus', 'vaanaya-pac-v1.jsonl');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'coverage.md');
const GOLDEN_PATH = path.join(ROOT_DIR, 'golden', 'golden-cases.jsonl');

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function sortedObject(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function calculateCoverage(records) {
  const coverage = {
    total: records.length,
    languages: {},
    difficulties: {},
    families: {},
    ambiguityTypes: {},
    fieldStates: {},
    clarificationIntents: {},
    prohibitedInferences: {},
    hardCount: 0,
    hardFraction: 0
  };

  for (const record of records) {
    increment(coverage.languages, record.language.path);
    increment(coverage.difficulties, record.scenario_tags.difficulty);
    increment(coverage.families, record.scenario_tags.family);
    if (['D3', 'D4', 'D5'].includes(record.scenario_tags.difficulty)) {
      coverage.hardCount += 1;
    }
    for (const ambiguity of record.scenario_tags.ambiguity_types) {
      increment(coverage.ambiguityTypes, ambiguity);
    }
    for (const field of Object.values(record.expected_pac)) {
      increment(coverage.fieldStates, field.state);
    }
    for (const clarification of record.required_clarifications) {
      increment(coverage.clarificationIntents, clarification.intent);
    }
    for (const prohibition of record.prohibited_inferences) {
      increment(coverage.prohibitedInferences, prohibition);
    }
  }

  coverage.hardFraction = records.length ? coverage.hardCount / records.length : 0;
  for (const key of [
    'languages',
    'difficulties',
    'families',
    'ambiguityTypes',
    'fieldStates',
    'clarificationIntents',
    'prohibitedInferences'
  ]) {
    coverage[key] = sortedObject(coverage[key]);
  }
  return coverage;
}

export function validateCoverage(coverage) {
  const errors = [];
  if (coverage.total !== 1000) errors.push('coverage total must equal 1000');
  if (Object.keys(coverage.families).length !== 15) {
    errors.push('coverage must include all 15 scenario families');
  }
  if (coverage.hardFraction < 0.6) {
    errors.push('D3-D5 coverage must be at least 60%');
  }
  for (const [language, expected] of Object.entries({
    'hi-hinglish': 700,
    'kn-kanglish': 150,
    en: 150
  })) {
    if (coverage.languages[language] !== expected) {
      errors.push(`${language} coverage must equal ${expected}`);
    }
  }
  for (const mechanic of [
    'correction',
    'record_conflict',
    'low_confidence',
    'remote_event',
    'medical_advice_request'
  ]) {
    if (!coverage.ambiguityTypes[mechanic]) errors.push(`missing mechanic ${mechanic}`);
  }
  return errors;
}

export function selectGoldenCases(records) {
  const templateIds = [...new Set(records.map(record => record.provenance.template_id))];
  const languageCycle = [
    'hi-hinglish',
    'hi-hinglish',
    'hi-hinglish',
    'hi-hinglish',
    'hi-hinglish',
    'hi-hinglish',
    'hi-hinglish',
    'hi-hinglish',
    'kn-kanglish',
    'kn-kanglish',
    'kn-kanglish',
    'kn-kanglish',
    'en',
    'en',
    'en'
  ];

  return templateIds.slice(0, 15).map((templateId, index) => {
    const desiredLanguage = languageCycle[index];
    return (
      records.find(
        record =>
          record.provenance.template_id === templateId &&
          record.language.path === desiredLanguage
      ) ?? records.find(record => record.provenance.template_id === templateId)
    );
  });
}

function table(title, values) {
  const rows = Object.entries(values)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join('\n');
  return `## ${title}\n\n| Value | Cases |\n|---|---:|\n${rows}\n`;
}

function renderReport(coverage, golden) {
  return `# Vaanaya PAC Corpus Coverage

**Generated:** 2026-07-26  
**Corpus:** \`vaanaya-pac-v1.jsonl\`  
**Total cases:** ${coverage.total}  
**D3–D5 cases:** ${coverage.hardCount} (${(coverage.hardFraction * 100).toFixed(1)}%)  
**Golden cases:** ${golden.length}

This report measures synthetic test coverage, not clinical accuracy or efficacy.

${table('Languages', coverage.languages)}
${table('Difficulty', coverage.difficulties)}
${table('Scenario families', coverage.families)}
${table('Ambiguity and friction mechanics', coverage.ambiguityTypes)}
${table('Expected PAC field states', coverage.fieldStates)}
${table('Clarification intents', coverage.clarificationIntents)}
${table('Prohibited inferences', coverage.prohibitedInferences)}
## Golden set

| Case | Language | Difficulty | Family | Template |
|---|---|---|---|---|
${golden
  .map(
    record =>
      `| ${record.case_id} | ${record.language.path} | ${record.scenario_tags.difficulty} | ${record.scenario_tags.family} | ${record.provenance.template_id} |`
  )
  .join('\n')}

## Feedback rule

Any missing family, weak difficulty distribution, unsafe inference, or clinician-review failure must be fixed in the scenario templates or validation contract, followed by complete regeneration. Generated JSONL records are never hand-patched.
`;
}

function main() {
  const { records, errors } = readJsonl(CORPUS_PATH);
  if (errors.length) throw new Error(errors.join('\n'));
  const coverage = calculateCoverage(records);
  const coverageErrors = validateCoverage(coverage);
  if (coverageErrors.length) throw new Error(coverageErrors.join('\n'));
  const golden = selectGoldenCases(records);
  if (golden.length !== 15 || golden.some(record => !record)) {
    throw new Error('Unable to select 15 golden cases');
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, renderReport(coverage, golden));
  fs.writeFileSync(
    GOLDEN_PATH,
    `${golden.map(record => JSON.stringify(record)).join('\n')}\n`
  );
  process.stdout.write(
    `Coverage passed: ${coverage.total} cases, ${(
      coverage.hardFraction * 100
    ).toFixed(1)}% D3-D5, ${Object.keys(coverage.families).length} families\n`
  );
  process.stdout.write(`Wrote ${REPORT_PATH}\nWrote ${GOLDEN_PATH}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

