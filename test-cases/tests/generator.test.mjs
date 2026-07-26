import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCorpus } from '../scripts/generate-corpus.mjs';
import { validateCorpus } from '../lib/contracts.mjs';

function countBy(records, selector) {
  return records.reduce((counts, record) => {
    const key = selector(record);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

test('generates the exact approved language distribution', () => {
  const cases = generateCorpus({ seed: 20260726 });
  assert.equal(cases.length, 1000);
  assert.deepEqual(countBy(cases, record => record.language.path), {
    'hi-hinglish': 700,
    'kn-kanglish': 150,
    en: 150
  });
});

test('is deterministic for a fixed seed', () => {
  assert.deepEqual(
    generateCorpus({ seed: 20260726 }),
    generateCorpus({ seed: 20260726 })
  );
});

test('changes surface variants when the seed changes', () => {
  assert.notDeepEqual(
    generateCorpus({ seed: 20260726 }).slice(0, 10),
    generateCorpus({ seed: 7 }).slice(0, 10)
  );
});

test('generates unique stable identifiers', () => {
  const cases = generateCorpus({ seed: 20260726 });
  assert.equal(new Set(cases.map(record => record.case_id)).size, 1000);
  assert.equal(cases[0].case_id, 'PAC-SYN-0001');
  assert.equal(cases[999].case_id, 'PAC-SYN-1000');
});

test('covers every declared scenario family', () => {
  const families = new Set(
    generateCorpus({ seed: 20260726 }).map(record => record.scenario_tags.family)
  );
  assert.equal(families.size, 15);
});

test('produces at least 60 percent D3-D5 cases', () => {
  const cases = generateCorpus({ seed: 20260726 });
  const hard = cases.filter(record =>
    ['D3', 'D4', 'D5'].includes(record.scenario_tags.difficulty)
  );
  assert.ok(hard.length >= 600, `received ${hard.length} D3-D5 cases`);
});

test('the complete generated corpus satisfies all invariants', () => {
  assert.deepEqual(validateCorpus(generateCorpus({ seed: 20260726 })), []);
});

