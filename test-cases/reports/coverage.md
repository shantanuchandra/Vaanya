# Vaanaya PAC Corpus Coverage

**Generated:** 2026-07-26  
**Corpus:** `vaanaya-pac-v1.jsonl`  
**Total cases:** 1000  
**D3–D5 cases:** 940 (94.0%)  
**Golden cases:** 15

This report measures synthetic test coverage, not clinical accuracy or efficacy.

## Languages

| Value | Cases |
|---|---:|
| en | 150 |
| hi-hinglish | 700 |
| kn-kanglish | 150 |

## Difficulty

| Value | Cases |
|---|---:|
| D2 | 60 |
| D3 | 380 |
| D4 | 370 |
| D5 | 190 |

## Scenario families

| Value | Cases |
|---|---:|
| allergy_reaction | 69 |
| antithrombotic_colloquial | 56 |
| comorbidity_history | 70 |
| conflicting_sources | 60 |
| fasting_readiness | 56 |
| forgotten_remote_event | 54 |
| low_confidence_audio | 77 |
| medication_identity | 83 |
| missing_documents | 60 |
| patient_teach_back | 72 |
| permissions_boundary | 68 |
| prior_anesthesia | 56 |
| self_correction | 86 |
| session_continuity | 62 |
| unsupported_clinical_request | 71 |

## Ambiguity and friction mechanics

| Value | Cases |
|---|---:|
| caregiver_access | 68 |
| caregiver_addition | 56 |
| colloquial_description | 56 |
| correction | 318 |
| cross_session | 62 |
| frequency | 86 |
| intake_time | 56 |
| low_confidence | 77 |
| medical_advice_request | 71 |
| medicine_name | 77 |
| missing_document | 60 |
| permission_scope | 68 |
| recency_bias | 54 |
| recent_use | 56 |
| record_conflict | 60 |
| remote_event | 110 |
| teach_back | 72 |
| unknown_control_status | 70 |
| unknown_name | 139 |
| unknown_reaction | 69 |
| versioning | 62 |

## Expected PAC field states

| Value | Cases |
|---|---:|
| captured | 353 |
| missing | 60 |
| uncertain | 587 |

## Clarification intents

| Value | Cases |
|---|---:|
| clarify_remote_event | 54 |
| clinician_confirm_teach_back | 72 |
| confirm_allergy_reaction | 69 |
| confirm_corrected_frequency | 86 |
| confirm_intake_details | 56 |
| confirm_medication_name | 83 |
| confirm_medication_name_and_record | 56 |
| confirm_prior_anesthesia_event | 56 |
| confirm_recent_records | 70 |
| maintain_case_boundary | 68 |
| reconcile_allergy_record | 60 |
| repeat_or_show_medicine | 77 |
| request_missing_report | 60 |
| review_and_propagate_correction | 62 |
| route_medication_question_to_clinician | 71 |

## Prohibited inferences

| Value | Cases |
|---|---:|
| assign_asa_class | 1000 |
| autonomous_signoff | 1000 |
| cross_patient_context_leak | 68 |
| determine_anesthetic_fitness | 1000 |
| diagnose_condition | 1000 |
| give_medication_holding_instruction | 127 |
| infer_anticoagulant_class | 56 |
| prescribe_medication | 71 |
| select_anesthetic_plan | 1000 |

## Golden set

| Case | Language | Difficulty | Family | Template |
|---|---|---|---|---|
| PAC-SYN-0001 | hi-hinglish | D3 | patient_teach_back | teach-back-approved-only |
| PAC-SYN-0002 | hi-hinglish | D5 | conflicting_sources | record-patient-conflict |
| PAC-SYN-0003 | hi-hinglish | D3 | medication_identity | medication-unknown-name |
| PAC-SYN-0004 | hi-hinglish | D5 | permissions_boundary | access-boundary |
| PAC-SYN-0005 | hi-hinglish | D4 | antithrombotic_colloquial | blood-thinner-colloquial |
| PAC-SYN-0006 | hi-hinglish | D4 | forgotten_remote_event | forgotten-remote-event |
| PAC-SYN-0008 | hi-hinglish | D3 | comorbidity_history | comorbidity-control-unknown |
| PAC-SYN-0009 | hi-hinglish | D5 | session_continuity | cross-session-correction |
| PAC-SYN-0721 | kn-kanglish | D4 | fasting_readiness | fasting-milk-tea-correction |
| PAC-SYN-0713 | kn-kanglish | D3 | allergy_reaction | allergy-reaction-unknown |
| PAC-SYN-0702 | kn-kanglish | D4 | unsupported_clinical_request | request-medication-advice |
| PAC-SYN-0711 | kn-kanglish | D2 | missing_documents | missing-report |
| PAC-SYN-0866 | en | D4 | prior_anesthesia | prior-anesthesia-caregiver-recall |
| PAC-SYN-0856 | en | D4 | low_confidence_audio | low-confidence-medicine |
| PAC-SYN-0851 | en | D3 | self_correction | mid-sentence-correction |

## Feedback rule

Any missing family, weak difficulty distribution, unsafe inference, or clinician-review failure must be fixed in the scenario templates or validation contract, followed by complete regeneration. Generated JSONL records are never hand-patched.
