import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCase, validateCorpus } from '../lib/contracts.mjs';
import { validFixture } from './fixtures.mjs';

test('accepts a valid synthetic case', () => {
  assert.deepEqual(validateCase(validFixture()), []);
});

test('rejects a captured PAC field without a valid source turn', () => {
  const record = validFixture();
  record.expected_pac.medications = {
    state: 'captured',
    value: 'aspirin',
    source_turn_ids: ['missing-turn']
  };
  assert.match(validateCase(record).join('\n'), /source turn/i);
});

test('rejects uncertain content that has no declared uncertainty', () => {
  const record = validFixture();
  record.uncertainties = [];
  assert.match(validateCase(record).join('\n'), /uncertainty/i);
});

test('rejects autonomous clinical sign-off', () => {
  const record = validFixture();
  record.expected_workflow.autonomous_signoff_allowed = true;
  assert.match(validateCase(record).join('\n'), /sign.?off/i);
});

test('rejects a case that is not explicitly synthetic', () => {
  const record = validFixture();
  record.patient_profile.synthetic = false;
  assert.match(validateCase(record).join('\n'), /synthetic/i);
});

test('rejects missing prohibited clinical inferences', () => {
  const record = validFixture();
  record.prohibited_inferences = ['infer_medication_name'];
  assert.match(validateCase(record).join('\n'), /prohibited inference/i);
});

test('rejects duplicate corpus identifiers', () => {
  const records = Array.from({ length: 1000 }, (_, index) => {
    const record = validFixture();
    record.case_id = `PAC-SYN-${String(index + 1).padStart(4, '0')}`;
    record.language.path =
      index < 700 ? 'hi-hinglish' : index < 850 ? 'kn-kanglish' : 'en';
    record.scenario_tags.difficulty = index < 600 ? 'D3' : 'D2';
    return record;
  });
  records[999].case_id = records[998].case_id;
  assert.match(validateCorpus(records).join('\n'), /duplicate case_id/i);
});

test('rejects the wrong language distribution', () => {
  const records = Array.from({ length: 1000 }, (_, index) => {
    const record = validFixture();
    record.case_id = `PAC-SYN-${String(index + 1).padStart(4, '0')}`;
    record.language.path = index < 701 ? 'hi-hinglish' : index < 850 ? 'kn-kanglish' : 'en';
    record.scenario_tags.difficulty = index < 600 ? 'D3' : 'D2';
    return record;
  });
  assert.match(validateCorpus(records).join('\n'), /language distribution/i);
});

test('rejects fewer than 60 percent D3-D5 cases', () => {
  const records = Array.from({ length: 1000 }, (_, index) => {
    const record = validFixture();
    record.case_id = `PAC-SYN-${String(index + 1).padStart(4, '0')}`;
    record.language.path =
      index < 700 ? 'hi-hinglish' : index < 850 ? 'kn-kanglish' : 'en';
    record.scenario_tags.difficulty = index < 599 ? 'D3' : 'D2';
    return record;
  });
  assert.match(validateCorpus(records).join('\n'), /difficulty coverage/i);
});

test('rejects any corpus size other than 1000', () => {
  assert.match(validateCorpus([validFixture()]).join('\n'), /exactly 1000/i);
});

