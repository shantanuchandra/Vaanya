# Synthetic Patient Cohort and Recordings List Design

## Objective

Expand the buildathon demo from a single patient into a clearly labelled
synthetic cohort and provide clinicians with one recordings-first worklist.
The worklist must make the next action obvious while reusing the existing
Evidence Rail and clinician-review workflow.

## Product Boundary

- Every seeded person, mobile number, conversation, and PAC record is synthetic.
- The interface must visibly label the cohort as synthetic demo data.
- PAC requirements are determined by procedure and applicable clinical context,
  not by gender alone.
- The product remains clinician-supervised documentation. It does not determine
  anesthetic fitness, assign ASA grade, diagnose, prescribe, or sign on behalf
  of a clinician.
- Pregnancy-related questions appear only when clinically applicable and may be
  explicitly marked not applicable; the system must not infer an answer.

## Synthetic Cohort

The demo seed contains ten patients with unique fictional Indian mobile
numbers. The five supplied names are represented as male synthetic patients.
Five additional female synthetic patients provide procedure and PAC variety.

| Patient | Synthetic sex | Procedure | Deliberate PAC focus |
|---|---|---|---|
| Shantanu Chandra | Male | Laparoscopic hernia repair | Hypertension medication verification |
| Udayan Walvekar | Male | Knee replacement | Diabetes medicines and functional capacity |
| Abhishek Patil | Male | Endoscopy | Unclear allergy response |
| Ameeth Dubey | Male | Urological procedure | Incomplete previous-anesthesia history |
| Rajnish Kumar | Male | Cataract surgery | Blood-thinner name and last-dose ambiguity |
| Ananya Rao | Female | Laparoscopic hysterectomy | Bleeding history, anaemia evidence, previous pelvic surgery |
| Meera Kulkarni | Female | Breast surgery | Medicines, allergies, and previous anesthesia |
| Kavya Nair | Female | Laparoscopic cholecystectomy | Applicable pregnancy question and recent symptoms |
| Priya Deshmukh | Female | Knee replacement | Diabetes, functional capacity, and medication reconciliation |
| Nandini Iyer | Female | Endoscopy | Fasting discussion and reflux history |

The cohort intentionally includes complete, missing, unclear, and contradictory
documentation states. These states demonstrate evidence-backed completeness
without treating an absent statement as a negative answer.

## Data Model and API

For the MVP, the cohort is seeded at the API/store boundary rather than
hardcoded into the React interface. Patient search and the recordings worklist
therefore consume the same source of truth.

Each list item exposes:

- encounter ID and patient summary;
- procedure and preferred language;
- recording timestamp;
- recording/processing status;
- checklist completion counts;
- critical-gap count;
- whether transcript evidence exists.

The API returns encounters in deterministic worklist order:

1. unprocessed uploads first, newest first within that group;
2. all other recordings newest first.

The client does not independently reorder the response. This keeps ordering
consistent across browser sessions and future clients.

## Recordings Page

Add a `Recordings` navigation destination beside the existing review
workspace. It displays a compact row or card for each synthetic encounter.

Each item shows:

- patient name with a `Synthetic` label;
- procedure;
- recording date and time;
- preferred language;
- status: `Uploaded`, `Processing`, `Ready for review`, `Signed`, or `Failed`;
- checklist answered/applicable count;
- unclear or missing critical-item count.

Available actions depend on status:

- `Process recording` for an uploaded item;
- `Open evidence` for a processed item;
- `Continue review` for an item awaiting clinician resolution;
- `View signed note` for a signed item;
- `Retry` for a failed item.

Selecting an item opens the existing encounter review and Evidence Rail. The
recordings page does not create a second evidence or editing implementation.

## Processing and Persistence

Transcript segments remain stored in Supabase when that adapter is active.
An encounter whose recording is already processed returns its stored transcript
and skips both Sarvam and OpenAI. Demo-memory mode provides the same observable
behavior for buildathon reliability.

Processing errors preserve the uploaded item, set it to `Failed`, and expose a
retry action. A failure must not erase an earlier transcript or clinician edit.

## Accessibility and Responsive Behavior

- Navigation and row actions use semantic links or buttons with accessible
  names.
- Status is conveyed by text in addition to color.
- Keyboard focus remains visible.
- On narrow screens, rows stack into cards without hiding patient, status,
  checklist summary, or primary action.
- Empty and loading states use plain language.

## Testing

Implementation follows test-driven development.

- Store/API tests verify all ten synthetic patients, fictional unique mobile
  numbers, search behavior, status mapping, and required sort order.
- API tests verify unprocessed items precede processed items and newest-first
  ordering within groups.
- UI tests verify navigation, all worklist fields, status-specific actions, and
  opening the existing Evidence Rail.
- Regression tests verify processing the same stored recording does not invoke
  Sarvam or OpenAI again.
- Full workspace tests, type-check, and production build must pass before
  completion.

## MVP Non-Goals

- Importing real patients or real contact details.
- A generic arbitrary-file recording library.
- Hospital-system synchronization.
- Autonomous checklist resolution or clinical sign-off.
- Analytics beyond the visible worklist completion counts.
