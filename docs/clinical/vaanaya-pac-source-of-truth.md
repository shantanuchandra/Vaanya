# Vaanaya PAC Source of Truth

**Version:** 0.1  
**Date:** 2026-07-26  
**Scope:** Product and test-design guidance for a clinician-supervised multilingual pre-anesthetic check-up documentation prototype.  
**Clinical status:** This is not a clinical protocol. Local hospital policy and the reviewing anesthesiologist govern care.

> Evidence labels
>
> - **[Evidence]** Supported by the cited publication or guideline.
> - **[Clinician validation]** Must be confirmed or adapted by the participating anesthesiologist.
> - **[Synthetic assumption]** Exists only to exercise product behavior.

## 1. Product thesis

Vaanaya converts a multilingual PAC conversation into a source-linked draft, makes missing and uncertain information visible, and requires a clinician to edit and sign the record. It should reduce clerical effort without converting uncertain speech into clinical fact.

The product does not diagnose, prescribe, assign ASA class, determine fitness for anesthesia, select an anesthetic technique, interpret investigations, or instruct a patient to start, stop, or hold medication.

## 2. What a pre-anesthesia evaluation contains

**[Evidence]** The American Society of Anesthesiologists describes pre-anesthesia history and physical examination as including review of pertinent medical records, patient interview, and physical examination before specific pre-anesthesia tests are ordered or performed. The advisory discusses associations between perioperative complications and patient characteristics or pre-existing conditions, but it does not turn those associations into permission for an AI system to make a clinical decision. [ASA Practice Advisory for Preanesthesia Evaluation](https://www.asahq.org/~/media/sites/asahq/files/public/resources/standards-guidelines/practice-advisory-for-preanesthesia-evaluation.pdf)

**[Evidence]** The WHO Surgical Safety Checklist includes confirmation of identity, site, procedure and consent; known allergy; difficult airway or aspiration risk; and major blood-loss risk before induction. WHO explicitly says the checklist is not comprehensive and should be adapted to local practice. [WHO Surgical Safety Checklist](https://www.who.int/docs/default-source/patient-safety/9789241598590-eng-checklist.pdf)

**[Clinician validation]** Vaanaya’s paper-PAC draft should use the participating anesthesiologist’s local form and terminology. The generic test model below is a coverage model, not a replacement form.

## 3. Generic paper-PAC information model

| Section | Example information | Product entry rule |
|---|---|---|
| Encounter context | Synthetic patient reference, procedure, date, language, consent | Clinician/coordinator entered |
| Medical history | Relevant conditions, prior admissions or events, functional history when asked | AI may propose with sources; clinician confirms |
| Current/recent medicines | Name or description, dose, frequency, indication, last use when stated | Never resolve an unknown medicine name by guessing |
| Allergy history | Substance, reaction, timing or uncertainty | Preserve “unknown reaction” distinctly |
| Previous anesthesia | Exposure, complication, difficult experience, family history when asked | AI may propose; clinician confirms |
| Fasting/readiness | Patient’s reported intake and time; referenced instructions or documents | Record the statement; clinician determines significance |
| Investigations/documents | Reports or prescriptions mentioned, present, missing or unreadable | Reference only; do not interpret |
| Examination | Local paper-form findings | Always clinician entered in this prototype |
| Open items | Missing, uncertain, intentionally skipped or follow-up needed | State must remain explicit |
| Clinician conclusion | Assessment, plan, fitness or local conclusion fields | Always clinician entered and signed |

## 4. Why medication and allergy ambiguity deserves priority

**[Evidence]** A prospective observational study comparing surgical and anesthesiology preoperative histories found at least one discrepancy in 58 of 79 records (73%). Different preoperative medications appeared in 56%, different doses or frequencies in 43%, and different allergy information in 23%. The result supports medication/allergy reconciliation as a high-value test family; it does not establish the same rates in an Indian hospital. [De Winter et al., “What is the patient really taking?”](https://pubmed.ncbi.nlm.nih.gov/16326785/)

**[Evidence]** A pre-surgical medication-history improvement project notes that histories recorded immediately before surgery may be rushed, incomplete or missed. Scheduled pharmacist calls increased completion within the studied pathway. This supports testing earlier clarification and missing-document recovery, not autonomous medication advice. [Kosaski et al., 2023](https://pubmed.ncbi.nlm.nih.gov/36593140/)

**[Evidence]** A medication-reconciliation study specifically evaluated medication, allergy and antithrombotic discrepancies during preoperative screening. It supports explicit testing of colloquial “blood thinner” descriptions and uncertainty, while the clinician remains responsible for management. [van den Bemt et al., 2009](https://pubmed.ncbi.nlm.nih.gov/19417112/)

**Product consequence:** If a patient says, “Woh khoon patla karne wali goli leta hoon… naam yaad nahi… kal bhi li thi,” Vaanaya may record:

- a medicine described by the patient as a “blood-thinning tablet”;
- medicine name unknown;
- last reported use yesterday;
- source turn and language;
- targeted request to confirm the name using a strip, prescription, caregiver or record.

It must not turn that description into “aspirin,” “clopidogrel,” an anticoagulant class, a dose, or an instruction to stop it.

## 5. Documentation completeness

**[Evidence]** A 2025 audit scored 268 paper and 163 electronic pre-anesthetic assessment records against 17 documentation items. Fewer than 1% of all records were fully complete; in that setting, electronic documentation did not automatically improve completeness. The study supports explicit field-state and completion checks rather than assuming digitisation is enough. [Punitham et al., 2025](https://pubmed.ncbi.nlm.nih.gov/41368793/)

**[Evidence]** A multicentre observational study reported basic preoperative history documented in fewer than 80% of reviewed anesthesia record sheets in its study setting. This is evidence that record completeness can be a measurable problem, not an estimate for Vaanaya’s target hospital. [Assessment of perioperative anesthesia record sheet completeness](https://pubmed.ncbi.nlm.nih.gov/35860144/)

**[Evidence]** In a chart-review study, anesthesiologists regarded airway examination and allergy status as important preoperative variables, while many variables were recorded inconsistently. Allergy status appeared on 84% of reviewed records. [Documentation on the anesthetic record](https://pubmed.ncbi.nlm.nih.gov/27771907/)

**Product consequence:** The system must distinguish:

- `captured`: supported by conversation sources;
- `uncertain`: something was said but one or more material attributes are unclear;
- `missing`: no relevant statement was captured;
- `intentionally_skipped`: clinician deliberately dismisses or defers the field;
- `clinician_entered`: content that the system must not originate.

Completeness means every required field is captured, explicitly unresolved, or intentionally handled. It does not mean every field contains an affirmative clinical finding.

## 6. Recall, forgotten events and corrections

**[Evidence]** Patient recall is imperfect even around the preoperative visit: in one small older study, 26.9% of 104 patients could not remember having been assessed by an anesthetist. This does not quantify forgotten medical-history events, but it cautions against treating recall as complete. [Ali et al., 1996](https://pubmed.ncbi.nlm.nih.gov/8682635)

**[Clinician validation]** The participating anesthesiologist identified forgotten prior events and recency bias as an important interview problem. Before using this as a public claim, she should document three anonymized pattern descriptions—not patient records—showing which prompts commonly surface remote events.

**Product consequence:** Test conversations should include:

- initial denial followed by recall after a contextual prompt;
- approximate dates and uncertain age at event;
- caregiver-supplied information;
- correction of a recent answer;
- conflict between paper, patient and caregiver;
- “I do not remember” remaining a valid final state.

Vaanaya must retain the original statement, link the correction, mark the current value, and avoid accusing the patient of inconsistency.

## 7. Language and understanding

**[Evidence]** A systematic review found strong evidence that professional interpreter use or language-concordant providers improve understanding of procedural consent for patients with limited English proficiency. It also found evidence of poorer understanding of discharge instructions among these patients, while noting limitations in the available outcomes literature. [Luan-Erfe et al., 2023](https://pubmed.ncbi.nlm.nih.gov/36066429/)

**[Evidence]** A broader systematic review found language barriers associated in some studies with reduced access, delays and longer surgical admissions, while effects varied by outcome and study. It supports careful communication design but not a claim that Vaanaya will reduce complications. [Joo et al., 2023](https://pubmed.ncbi.nlm.nih.gov/37432686/)

**[Evidence]** A small perioperative communication-device study reported high comprehension and acceptance of native-language instructions, but was not powered to establish patient-safety improvement. It supports testing native-language instruction delivery while keeping efficacy claims restrained. [Taicher et al., 2011](https://pubmed.ncbi.nlm.nih.gov/21081767/)

**Product consequence:**

- Preserve original utterance and translated meaning together.
- Show low confidence and targeted retry rather than hiding uncertainty.
- Treat code-mixed clinical terms and medicine names as source evidence, not automatically translated facts.
- Generate patient instructions only from clinician-approved content.
- Use teach-back as an understanding check, never as a claim of legal consent.
- The deep test path is Hindi/Hinglish; Kannada/Kanglish is the secondary handoff path.

## 8. Safety hierarchy for test design

This is a product-test prioritization, not a clinical ranking.

### Tier A: Never silently infer

- medicine identity, dose, frequency or last use;
- allergy substance or reaction;
- previous anesthesia complication;
- significant prior event or diagnosis;
- fasting intake or time;
- identity, procedure or consent;
- examination finding;
- clinician conclusion.

### Tier B: Require visible uncertainty and a recovery path

- colloquial medicine descriptions;
- uncertain or approximate dates;
- inaudible names and numbers;
- patient/caregiver disagreement;
- record/patient disagreement;
- missing prescription, strip or report;
- unsupported language or failed transcription;
- question asking for diagnosis or medication management.

### Tier C: Preserve continuity

- correction propagation;
- signed-versus-draft separation;
- approved patient-summary version;
- current versus superseded information;
- authenticated case boundary;
- cross-session or Telegram handoff.

## 9. Consequential failure selection

There is no defensible universal statement from the reviewed sources that one PAC failure is always the most consequential. Consequence depends on patient, procedure and local practice.

For the buildathon, use **unresolved medication/allergy/prior-anesthesia ambiguity** as the demonstrated failure cluster because:

1. medication and allergy discrepancies are empirically documented;
2. they naturally expose multilingual and colloquial speech difficulty;
3. safe behavior is easy to judge: preserve uncertainty, cite the source, ask precisely, and require clinician action;
4. the cluster demonstrates value without making a diagnosis or treatment recommendation.

**[Clinician validation]** The participating anesthesiologist must approve the selected golden cases and may reprioritize scenario weights based on local workflow.

## 10. Time-saving measurement

Primary metric: **clinician minutes from encounter start to signed PAC record**.

### Demonstration protocol

1. Use three fixed synthetic cases: D2, D4 and D5.
2. The participating anesthesiologist completes each on the current paper PAC format.
3. After a washout or reordered sequence, she completes the same information workflow with Vaanaya.
4. Record total time and post-conversation documentation time separately.
5. Report all three measurements and the median.
6. Record unresolved-field count and required corrections as guardrail metrics.

**[Synthetic assumption]** The product hypothesis is a 20% reduction in median clinician time without increasing unresolved or incorrectly captured fields.

Do not describe this three-case demonstration as clinical efficacy, general hospital productivity, or patient-safety improvement.

## 11. Feedback loops

### Clinical learning loop

Synthetic case → Vaanaya output → anesthesiologist review → error classification → template/contract revision → regenerated corpus.

### Product safety loop

Low-confidence or contradictory evidence → visible uncertainty → targeted clarification → clinician decision → signed version → approved patient handoff.

### Impact loop

Paper baseline → prototype timing → error/omission guardrails → workflow revision → repeated timed case.

Optimizing time without omission guardrails creates a harmful loop: the system can appear faster by recording less. Both measurements are therefore required.

## 12. Questions for anesthesiologist validation

Review these before using the golden set publicly:

1. Does the generic field taxonomy match the local paper form?
2. Which fields are required, optional, examination-only and conclusion-only?
3. Which neutral prompts most reliably surface forgotten remote events?
4. Which colloquial medication descriptions are common locally?
5. How should caregiver-supplied information be labelled?
6. Which contradiction types require immediate resolution versus a documented open item?
7. Which Hindi/Hinglish and Kannada/Kanglish phrases sound unnatural or unsafe?
8. Does each golden case stop at documentation and avoid management advice?

## 13. Source limitations

- Much of the cited evidence comes from health systems outside India and cannot supply a local baseline.
- Several studies are observational, small, or focused on perioperative stages beyond PAC.
- Language-barrier evidence supports communication assistance, not replacement of qualified interpreters where required.
- The corpus is synthetic and can measure application conformance, not clinical outcomes.
- Local policy, specialty judgment and production governance remain outside the buildathon prototype.

