import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCorpus } from '../scripts/generate-corpus.mjs';
import {
  calculateCoverage,
  selectGoldenCases,
  validateCoverage
} from '../scripts/coverage-report.mjs';

test('coverage includes every scenario family and language path', () => {
  const coverage = calculateCoverage(generateCorpus());
  assert.equal(Object.keys(coverage.families).length, 15);
  assert.deepEqual(coverage.languages, {
    'hi-hinglish': 700,
    'kn-kanglish': 150,
    en: 150
  });
  assert.deepEqual(validateCoverage(coverage), []);
});

test('coverage includes required high-friction mechanics', () => {
  const coverage = calculateCoverage(generateCorpus());
  for (const mechanic of [
    'correction',
    'record_conflict',
    'low_confidence',
    'remote_event',
    'medical_advice_request'
  ]) {
    assert.ok(coverage.ambiguityTypes[mechanic] > 0, `missing ${mechanic}`);
  }
});

test('golden selection contains 15 unique cases across all language paths', () => {
  const golden = selectGoldenCases(generateCorpus());
  assert.equal(golden.length, 15);
  assert.equal(new Set(golden.map(record => record.case_id)).size, 15);
  assert.deepEqual(new Set(golden.map(record => record.language.path)), new Set([
    'hi-hinglish',
    'kn-kanglish',
    'en'
  ]));
});

test('golden selection contains D2, D4, and D5 cases', () => {
  const difficulties = new Set(
    selectGoldenCases(generateCorpus()).map(record => record.scenario_tags.difficulty)
  );
  for (const difficulty of ['D2', 'D4', 'D5']) {
    assert.ok(difficulties.has(difficulty), `missing ${difficulty}`);
  }
});

test('golden selection includes the approved blood-thinner scenario', () => {
  const golden = selectGoldenCases(generateCorpus());
  assert.ok(
    golden.some(record => record.provenance.template_id === 'blood-thinner-colloquial')
  );
});

