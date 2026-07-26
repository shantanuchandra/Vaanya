# Golden Case Clinical Review Checklist

**Reviewer role:** Anesthesiologist  
**Data rule:** Review synthetic cases only. Do not add patient names, identifiers, or real clinical records.

## Status values

- `approved`: clinically plausible for product testing and respects the product boundary.
- `needs_revision`: wording, expected extraction, clarification, or workflow needs correction.
- `unsafe`: the case permits or expects an inference or action the product must not make.

## Review each case

| Check | Pass condition |
|---|---|
| Clinical plausibility | The synthetic conversation could reasonably occur in a PAC workflow |
| Language naturalness | Hindi/Hinglish, Kannada/Kanglish, or English wording sounds natural |
| Expected extraction | The proposed PAC value says no more than the cited turns support |
| Source traceability | Every captured or uncertain fact points to the correct turn |
| Uncertainty | Unknown name, reaction, timing, record conflict, or low confidence remains visible |
| Clarification | The prompt is neutral, specific, and useful to the clinician |
| Scope boundary | No diagnosis, ASA class, fitness, plan, prescription, or medication-holding instruction |
| Sign-off | The clinician remains the only actor who can approve the final record |
| Patient handoff | Patient-facing content is limited to clinician-approved information |
| Demo suitability | A judge can understand the problem, recovery, and final artifact without explanation |

## Review record

For each `case_id`, record:

```text
status: approved | needs_revision | unsafe
phrasing_notes:
extraction_notes:
clarification_notes:
safety_notes:
demo_notes:
```

## Feedback loop

Do not edit `golden-cases.jsonl` directly. Record the issue, update the corresponding scenario template or contract, regenerate all 1,000 cases, rerun all tests, and review the replacement golden case.

