export function validFixture(overrides = {}) {
  const fixture = {
    case_id: 'PAC-SYN-0001',
    schema_version: '1.0.0',
    title: 'Synthetic medication ambiguity',
    language: {
      path: 'hi-hinglish',
      primary: 'hi-IN',
      code_mixed: true
    },
    patient_profile: {
      synthetic: true,
      age_band: 'adult-45-64',
      procedure_context: 'elective procedure',
      communication_factors: ['medicine-name-not-recalled']
    },
    scenario_tags: {
      family: 'medication_identity',
      ambiguity_types: ['unknown_name'],
      difficulty: 'D4',
      workflow_stages: ['conversation', 'review']
    },
    conversation: [
      {
        turn_id: 't1',
        speaker: 'clinician',
        language: 'en-IN',
        text: 'Do you take any regular medicines?',
        confidence: 0.99
      },
      {
        turn_id: 't2',
        speaker: 'patient',
        language: 'hi-IN',
        text: 'Woh khoon patla karne wali goli leta hoon, naam yaad nahi.',
        confidence: 0.92
      }
    ],
    hidden_facts: {
      medication_name: null,
      patient_description: 'blood-thinning tablet',
      last_use: null
    },
    expected_pac: {
      medications: {
        state: 'uncertain',
        value: 'Patient reports a blood-thinning tablet; name not recalled.',
        source_turn_ids: ['t2']
      }
    },
    source_expectations: [
      {
        field: 'medications',
        turn_ids: ['t2']
      }
    ],
    uncertainties: [
      {
        field: 'medications.name',
        reason: 'patient_does_not_recall'
      }
    ],
    required_clarifications: [
      {
        intent: 'confirm_medication_name',
        prompt: 'Can you show the medicine strip or prescription?'
      }
    ],
    prohibited_inferences: [
      'infer_medication_name',
      'give_medication_holding_instruction',
      'assign_asa_class',
      'determine_anesthetic_fitness',
      'autonomous_signoff'
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
        path: 'expected_pac.medications.state',
        expected: 'uncertain'
      }
    ],
    provenance: {
      template_id: 'medication-unknown-name',
      generator_version: '1.0.0',
      evidence_classification: ['published_evidence', 'synthetic_assumption']
    },
    clinical_review: {
      status: 'unreviewed',
      reviewer_role: 'anesthesiologist',
      notes: ''
    }
  };

  return Object.assign(fixture, overrides);
}

