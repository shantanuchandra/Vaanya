const REQUIRED_TOP_LEVEL = [
  'case_id',
  'schema_version',
  'title',
  'language',
  'patient_profile',
  'scenario_tags',
  'conversation',
  'hidden_facts',
  'expected_pac',
  'source_expectations',
  'uncertainties',
  'required_clarifications',
  'prohibited_inferences',
  'expected_workflow',
  'assertions',
  'provenance',
  'clinical_review'
];

const FIELD_STATES = new Set([
  'captured',
  'uncertain',
  'missing',
  'intentionally_skipped',
  'clinician_entered'
]);

const REQUIRED_PROHIBITIONS = [
  'assign_asa_class',
  'determine_anesthetic_fitness',
  'autonomous_signoff'
];

const LANGUAGE_TARGETS = {
  'hi-hinglish': 700,
  'kn-kanglish': 150,
  en: 150
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateCase(record) {
  const errors = [];
  const prefix = isObject(record) && record.case_id ? record.case_id : 'case';

  if (!isObject(record)) return ['case must be an object'];

  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in record)) errors.push(`${prefix}: missing required property ${key}`);
  }
  if (errors.length) return errors;

  if (!/^PAC-SYN-\d{4}$/.test(record.case_id)) {
    errors.push(`${prefix}: case_id must use PAC-SYN-0000 format`);
  }
  if (record.schema_version !== '1.0.0') {
    errors.push(`${prefix}: schema_version must be 1.0.0`);
  }
  if (!['hi-hinglish', 'kn-kanglish', 'en'].includes(record.language?.path)) {
    errors.push(`${prefix}: unsupported language path`);
  }
  if (record.patient_profile?.synthetic !== true) {
    errors.push(`${prefix}: patient profile must be explicitly synthetic`);
  }
  if (!/^D[1-5]$/.test(record.scenario_tags?.difficulty ?? '')) {
    errors.push(`${prefix}: difficulty must be D1 through D5`);
  }

  const turns = Array.isArray(record.conversation) ? record.conversation : [];
  const turnIds = new Set();
  for (const [index, turn] of turns.entries()) {
    if (!turn?.turn_id || turnIds.has(turn.turn_id)) {
      errors.push(`${prefix}: conversation turn ${index + 1} has missing or duplicate turn_id`);
    } else {
      turnIds.add(turn.turn_id);
    }
    if (!['clinician', 'patient', 'caregiver', 'system'].includes(turn?.speaker)) {
      errors.push(`${prefix}: conversation turn ${index + 1} has invalid speaker`);
    }
    if (typeof turn?.text !== 'string' || turn.text.trim() === '') {
      errors.push(`${prefix}: conversation turn ${index + 1} has empty text`);
    }
    if (
      typeof turn?.confidence !== 'number' ||
      turn.confidence < 0 ||
      turn.confidence > 1
    ) {
      errors.push(`${prefix}: conversation turn ${index + 1} has invalid confidence`);
    }
  }

  const declaredUncertainties = Array.isArray(record.uncertainties)
    ? record.uncertainties.map(item => item.field)
    : [];

  for (const [field, fieldRecord] of Object.entries(record.expected_pac ?? {})) {
    if (!isObject(fieldRecord) || !FIELD_STATES.has(fieldRecord.state)) {
      errors.push(`${prefix}: PAC field ${field} has invalid state`);
      continue;
    }

    const sources = Array.isArray(fieldRecord.source_turn_ids)
      ? fieldRecord.source_turn_ids
      : [];

    if (['captured', 'uncertain'].includes(fieldRecord.state) && sources.length === 0) {
      errors.push(`${prefix}: PAC field ${field} requires a source turn`);
    }
    for (const sourceId of sources) {
      if (!turnIds.has(sourceId)) {
        errors.push(`${prefix}: PAC field ${field} references unknown source turn ${sourceId}`);
      }
    }
    if (
      fieldRecord.state === 'uncertain' &&
      !declaredUncertainties.some(path => path === field || path.startsWith(`${field}.`))
    ) {
      errors.push(`${prefix}: PAC field ${field} is uncertain without a declared uncertainty`);
    }
  }

  for (const expectation of record.source_expectations ?? []) {
    for (const sourceId of expectation.turn_ids ?? []) {
      if (!turnIds.has(sourceId)) {
        errors.push(`${prefix}: source expectation references unknown source turn ${sourceId}`);
      }
    }
  }

  if (record.expected_workflow?.clinician_review_required !== true) {
    errors.push(`${prefix}: clinician review must be required`);
  }
  if (record.expected_workflow?.explicit_signoff_required !== true) {
    errors.push(`${prefix}: explicit sign-off must be required`);
  }
  if (record.expected_workflow?.autonomous_signoff_allowed !== false) {
    errors.push(`${prefix}: autonomous sign-off is prohibited`);
  }
  if (record.expected_workflow?.patient_summary_from_approved_content_only !== true) {
    errors.push(`${prefix}: patient summary must use approved content only`);
  }

  for (const prohibition of REQUIRED_PROHIBITIONS) {
    if (!record.prohibited_inferences.includes(prohibition)) {
      errors.push(`${prefix}: missing required prohibited inference ${prohibition}`);
    }
  }

  if (
    !['unreviewed', 'approved', 'needs_revision', 'unsafe'].includes(
      record.clinical_review?.status
    )
  ) {
    errors.push(`${prefix}: invalid clinical review status`);
  }

  return errors;
}

export function validateCorpus(records) {
  const errors = [];
  if (!Array.isArray(records)) return ['corpus must be an array'];

  if (records.length !== 1000) {
    errors.push(`corpus must contain exactly 1000 cases; received ${records.length}`);
  }

  const identifiers = new Set();
  const languageCounts = { 'hi-hinglish': 0, 'kn-kanglish': 0, en: 0 };
  let hardCount = 0;

  for (const record of records) {
    errors.push(...validateCase(record));
    if (identifiers.has(record?.case_id)) {
      errors.push(`duplicate case_id: ${record.case_id}`);
    }
    identifiers.add(record?.case_id);

    if (record?.language?.path in languageCounts) {
      languageCounts[record.language.path] += 1;
    }
    if (['D3', 'D4', 'D5'].includes(record?.scenario_tags?.difficulty)) {
      hardCount += 1;
    }
  }

  for (const [path, target] of Object.entries(LANGUAGE_TARGETS)) {
    if (languageCounts[path] !== target) {
      errors.push(
        `language distribution mismatch for ${path}: expected ${target}, received ${languageCounts[path]}`
      );
    }
  }

  if (records.length > 0 && hardCount / records.length < 0.6) {
    errors.push(
      `difficulty coverage must be at least 60% D3-D5; received ${(
        (hardCount / records.length) *
        100
      ).toFixed(1)}%`
    );
  }

  return errors;
}

export const corpusTargets = Object.freeze({
  total: 1000,
  languages: Object.freeze({ ...LANGUAGE_TARGETS }),
  minimumHardFraction: 0.6
});

