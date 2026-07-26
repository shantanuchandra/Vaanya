import { useEffect, useMemo, useRef, useState } from "react";
import AudioPlayer from "react-h5-audio-player";
import "react-h5-audio-player/lib/styles.css";
import {
  ArrowRight,
  CircleAlert,
  FileCheck2,
  Languages,
  Mic2,
  Radio,
  ShieldCheck,
  Sparkles,
  Volume2,
  Printer,
  Search
} from "lucide-react";
import type {
  Encounter,
  PatientSummary,
  TranscriptTurn
} from "@vaanaya/contracts";
import { evaluateChecklist } from "@vaanaya/contracts";
import {
  createEncounterRequest,
  decideChecklistSuggestionRequest,
  deferChecklistItemRequest,
  enterChecklistItemRequest,
  processCompleteExampleRecording,
  processCompleteRecordingFile,
  createKannadaHandoff,
  createPatientSummaryHandoff,
  getEncounter,
  publishChecklistSuggestionsRequest,
  requestSecondOpinion,
  resolveField,
  searchPatients,
  signEncounterRequest,
  type KannadaHandoff,
  type PatientSummaryHandoff,
  type PatientSummaryLanguageCode
} from "./api";
import { PacChecklist } from "./PacChecklist";
import { EvidenceText } from "./EvidenceText";
import { SpeechCapture } from "./SpeechCapture";
import "./styles.css";

const COMPLETE_SYNTHETIC_RECORDING_FILENAME =
  "WhatsApp Audio 2026-07-26 at 09.14.01.mp4";
const patientSummaryLanguages: Array<{
  code: PatientSummaryLanguageCode;
  label: string;
}> = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "Hindi" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" }
];

function formatOffset(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatDuration(seconds: number) {
  return formatOffset(Math.floor(seconds));
}

function recordingSummary(
  encounter: Encounter,
  hasLegacyUploadedRecording = false
) {
  const totalSeconds = encounter.recordings.reduce(
    (sum, recording) => sum + recording.durationSeconds,
    0
  );
  if (encounter.recordings.length > 0) {
    return {
      label: `${encounter.recordings.length} ${
        encounter.recordings.length === 1 ? "recording" : "recordings"
      }`,
      duration: formatDuration(totalSeconds)
    };
  }
  if (hasLegacyUploadedRecording) {
    return {
      label: "1 recording",
      duration: null
    };
  }
  return {
    label: "No recordings",
    duration: null
  };
}

function EvidenceTurn({
  turn,
  active
}: {
  turn: TranscriptTurn;
  active: boolean;
}) {
  return (
    <article className={`evidence-turn${active ? " is-active" : ""}`}>
      <div className="turn-time">{formatOffset(turn.offsetSeconds)}</div>
      <div className="turn-marker" aria-hidden="true" />
      <div className="turn-copy">
        <div className="turn-meta">
          <span>{turn.speaker}</span>
          <span>{turn.language}</span>
          <span>{Math.round(turn.confidence * 100)}% confidence</span>
        </div>
        <EvidenceText
          text={turn.original}
          phrases={turn.evidencePhrases ?? []}
          lang={turn.language}
        />
        <EvidenceText
          className="translation"
          text={turn.translation}
          phrases={turn.evidencePhrases ?? []}
          lang="en-IN"
        />
      </div>
    </article>
  );
}

function App() {
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(
    null
  );
  const [procedure, setProcedure] = useState("Elective abdominal procedure");
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recordingAction, setRecordingAction] = useState<
    "complete" | "file" | null
  >(null);
  const [selectedRecordingFile, setSelectedRecordingFile] =
    useState<File | null>(null);
  const [selectedRecordingPreviewUrl, setSelectedRecordingPreviewUrl] =
    useState<string | null>(null);
  const [handoff, setHandoff] = useState<KannadaHandoff | null>(null);
  const [patientSummaryLanguage, setPatientSummaryLanguage] =
    useState<PatientSummaryLanguageCode>("hi-IN");
  const [patientSummaryHandoff, setPatientSummaryHandoff] =
    useState<PatientSummaryHandoff | null>(null);
  const [patientAudioStarted, setPatientAudioStarted] = useState(false);
  const patientAudioRef = useRef<HTMLAudioElement | null>(null);
  const [summaryEmailSent, setSummaryEmailSent] = useState(false);

  useEffect(() => {
    let active = true;
    const encounterId =
      new URLSearchParams(window.location.search).get("encounter") ?? "demo";
    getEncounter(encounterId)
      .then(data => {
        if (!active) return;
        setEncounter(data);
        setSelectedField(data.proposals[0]?.id ?? null);
        setSelectedPatient(data.patient ?? null);
        setProcedure(data.procedure);
      })
      .catch(error => {
        if (active)
          setNotice(
            error instanceof Error ? error.message : "Encounter unavailable."
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedRecordingFile) {
      setSelectedRecordingPreviewUrl(null);
      return;
    }
    if (
      typeof URL.createObjectURL !== "function" ||
      typeof URL.revokeObjectURL !== "function"
    ) {
      setSelectedRecordingPreviewUrl(null);
      return;
    }
    const previewUrl = URL.createObjectURL(selectedRecordingFile);
    setSelectedRecordingPreviewUrl(previewUrl);
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [selectedRecordingFile]);

  useEffect(() => {
    let active = true;
    const encounterPatient = encounter?.patient;
    const fallbackPatient =
      encounterPatient && patientMatchesQuery(encounterPatient, patientQuery)
        ? [encounterPatient]
        : [];
    searchPatients(patientQuery)
      .then(results => {
        if (active) setPatients(results.length ? results : fallbackPatient);
      })
      .catch(() => {
        if (active) setPatients(fallbackPatient);
      });
    return () => {
      active = false;
    };
  }, [
    encounter?.patient?.displayName,
    encounter?.patient?.id,
    encounter?.patient?.mobileLast4,
    encounter?.patient?.mobileNumber,
    patientQuery
  ]);

  const selectedProposal = encounter?.proposals.find(
    proposal => proposal.id === selectedField
  );
  const displayedChecklist = useMemo(() => {
    if (!encounter) return null;
    return (
      encounter.checklist ??
      evaluateChecklist({
        procedure: encounter.procedure,
        contextFlags: encounter.checklistContext.contextFlags,
        proposals: encounter.proposals,
        transcript: encounter.transcript,
        additionalItems: encounter.checklistExtensions
      })
    );
  }, [encounter]);
  const selectedChecklistItem = displayedChecklist?.items.find(
    item => item.id === selectedField
  );
  const sourceIds = useMemo(
    () =>
      new Set(
        selectedChecklistItem?.sourceTurnIds ??
          selectedProposal?.sourceTurnIds ??
          []
      ),
    [selectedChecklistItem, selectedProposal]
  );
  const hasSyntheticProcessedRecording = Boolean(
    encounter?.audit.some(
      event =>
        event.action === "recording.synthetic_processed" &&
        event.detail.syntheticDemo === true
    )
  );
  const hasLegacyUploadedRecording = Boolean(
    encounter?.audit.some(
      event => event.action === "recording.synthetic_processed"
    )
  );
  const evidenceRecordingSummary = useMemo(
    () =>
      encounter
        ? recordingSummary(encounter, hasLegacyUploadedRecording)
        : null,
    [encounter, hasLegacyUploadedRecording]
  );

  async function confirmSelectedField() {
    if (!encounter || !selectedChecklistItem || !resolution.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated =
        selectedProposal?.state === "uncertain"
          ? await resolveField(encounter.id, selectedProposal.id, resolution)
          : await enterChecklistItemRequest(
              encounter.id,
              selectedChecklistItem.id,
              resolution
            );
      setEncounter(updated);
      setResolution("");
      setNotice("Field confirmed. The original source remains attached.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function decideChecklistSuggestion(
    suggestionId: string,
    decision: "approve" | "reject"
  ) {
    if (!encounter) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await decideChecklistSuggestionRequest(
        encounter.id,
        suggestionId,
        decision
      );
      setEncounter(updated);
      setNotice(
        decision === "approve"
          ? "Question approved for this PAC. Publish it to reuse for this procedure."
          : "Question rejected and excluded from this PAC."
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deferSelectedChecklistItem() {
    if (!encounter || !selectedChecklistItem || !resolution.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await deferChecklistItemRequest(
        encounter.id,
        selectedChecklistItem.id,
        resolution
      );
      setEncounter(updated);
      setResolution("");
      setNotice("Checklist item deferred with the clinician’s reason recorded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Deferral failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publishChecklistSuggestions() {
    if (!encounter) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await publishChecklistSuggestionsRequest(encounter.id);
      setEncounter(updated);
      setNotice(
        `Procedure checklist v${updated.checklistLibrary?.version ?? 1} published to the organization library.`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signNote() {
    if (!encounter) return;
    setBusy(true);
    setNotice(null);
    try {
      const signed = await signEncounterRequest(encounter.id);
      setEncounter(signed);
      setNotice("PAC note signed. Version 1 is now immutable.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sign-off failed.");
    } finally {
      setBusy(false);
    }
  }

  async function generateKannadaHandoff() {
    if (!encounter) return;
    setBusy(true);
    setNotice(null);
    try {
      const generated = await createKannadaHandoff(encounter.id);
      setHandoff(generated);
      setNotice("Clinician-approved Kannada handoff is ready.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Handoff failed.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadCompleteSyntheticRecording() {
    if (!selectedPatient) return;
    setBusy(true);
    setRecordingAction("complete");
    setSummaryEmailSent(false);
    setNotice(`Uploading ${COMPLETE_SYNTHETIC_RECORDING_FILENAME}`);
    try {
      const draft =
        encounter?.patient?.id === selectedPatient.id
          ? encounter
          : await createEncounterRequest({
              patientId: selectedPatient.id,
              procedure: procedure.trim(),
              preferredLanguage: encounter?.preferredLanguage ?? "hi-IN",
              sourceType: "uploaded_mp4"
            });
      const extracted = await processCompleteExampleRecording(draft.id);
      setEncounter(extracted.encounter);
      setSelectedField(extracted.encounter.proposals.at(-1)?.id ?? null);
      setNotice(
        "Complete synthetic recording processed with Sarvam diarization and OpenAI PAC structuring."
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Complete synthetic recording upload failed."
      );
    } finally {
      setBusy(false);
      setRecordingAction(null);
    }
  }

  async function uploadSelectedRecordingFile() {
    if (!selectedPatient || !selectedRecordingFile) return;
    setBusy(true);
    setRecordingAction("file");
    setSummaryEmailSent(false);
    setNotice(`Uploading ${selectedRecordingFile.name}`);
    try {
      const draft =
        encounter?.patient?.id === selectedPatient.id
          ? encounter
          : await createEncounterRequest({
              patientId: selectedPatient.id,
              procedure: procedure.trim(),
              preferredLanguage: encounter?.preferredLanguage ?? "hi-IN",
              sourceType: "uploaded_mp4"
            });
      const extracted = await processCompleteRecordingFile(
        draft.id,
        selectedRecordingFile
      );
      setEncounter(extracted.encounter);
      setSelectedField(extracted.encounter.proposals.at(-1)?.id ?? null);
      setNotice(
        `${extracted.filename} processed with Sarvam diarization and OpenAI PAC structuring.`
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Selected recording upload failed."
      );
    } finally {
      setBusy(false);
      setRecordingAction(null);
    }
  }

  async function raiseSecondOpinion() {
    if (!encounter) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await requestSecondOpinion(encounter.id);
      setEncounter(updated);
      setNotice("2nd opinion requested. This PAC is now highlighted in conversation listings.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Second opinion could not be requested."
      );
    } finally {
      setBusy(false);
    }
  }

  function mockEmailCustomerSummary() {
    if (!encounter?.customerSummary) return;
    const recipient = encounter.patient?.displayName ?? encounter.patientReference;
    setSummaryEmailSent(true);
    setNotice(`Mock email queued for ${recipient}.`);
  }

  async function generatePatientSummaryAudio() {
    if (!encounter?.customerSummary) return;
    setBusy(true);
    setNotice(null);
    try {
      const generated = await createPatientSummaryHandoff(
        encounter.id,
        patientSummaryLanguage
      );
      setPatientSummaryHandoff(generated);
      setPatientAudioStarted(false);
      setNotice("Patient-language summary audio is ready.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Patient summary audio could not be generated."
      );
    } finally {
      setBusy(false);
    }
  }

  async function playPatientSummaryAudio() {
    try {
      await patientAudioRef.current?.play();
    } catch {
      setNotice(
        "Patient audio could not be played. Use the audio controls below."
      );
    }
  }

  if (!encounter) {
    return (
      <main className="loading-shell">
        <div className="loading-mark"><Mic2 size={20} /></div>
        <p>{notice ?? "Loading the synthetic PAC encounter…"}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Vaanaya home">
          <span className="brand-mark">V</span>
          <span>
            <strong>Vaanaya</strong>
            <small>Pre-anesthetic record</small>
          </span>
        </a>
        <nav className="topbar-nav" aria-label="Workspace navigation">
          <a href="/">
            Review workspace
          </a>
          <a href="/recordings">
            Recordings
          </a>
        </nav>
        <div className="encounter-state">
          <span className="live-dot" />
          Review in progress
          <span className="state-divider" />
          Synthetic data
        </div>
        <button className="clinician-chip" type="button">
          <span>MC</span>
          Dr Meera · Anesthesiologist
        </button>
      </header>

      <main className="review-page">
        <section className="patient-workflow" aria-label="Patient PAC workflow">
          <div className="patient-search">
            <label>
              Find patient
              <span>
                <Search size={15} />
                <input
                  value={patientQuery}
                  onChange={event => setPatientQuery(event.target.value)}
                  placeholder="Name or mobile number"
                />
              </span>
            </label>
            <div className="patient-results" aria-label="Patient results">
              {patients.map(patient => (
                <button
                  key={patient.id}
                  className={
                    selectedPatient?.id === patient.id
                      ? "patient-result is-selected"
                      : "patient-result"
                  }
                  type="button"
                  onClick={() => setSelectedPatient(patient)}
                >
                  <strong>{patient.displayName}</strong>
                  <small>
                    {patient.sex ? `${capitalize(patient.sex)} · ` : ""}
                    mobile ending {patient.mobileLast4}
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div className="recording-actions">
            <label>
              Procedure
              <input
                value={procedure}
                onChange={event => setProcedure(event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={uploadCompleteSyntheticRecording}
              disabled={!selectedPatient || !procedure.trim() || busy}
            >
              <Radio size={16} />
              {recordingAction === "complete"
                ? "Diarizing and translating with Sarvam..."
                : "Upload complete synthetic recording"}
            </button>
            <label className="recording-file-picker">
              Conversation recording file
              <input
                type="file"
                accept="audio/*,video/mp4,.mp4,.m4a,.webm,.wav,.mp3"
                onChange={event =>
                  setSelectedRecordingFile(event.currentTarget.files?.[0] ?? null)
                }
              />
              {selectedRecordingFile ? (
                <span>{selectedRecordingFile.name}</span>
              ) : null}
              {selectedRecordingPreviewUrl ? (
                <div className="selected-recording-preview">
                  <AudioPlayer
                    src={selectedRecordingPreviewUrl}
                    showJumpControls={false}
                    customAdditionalControls={[]}
                    customVolumeControls={[]}
                    layout="horizontal"
                  />
                </div>
              ) : null}
            </label>
            <button
              type="button"
              onClick={uploadSelectedRecordingFile}
              disabled={
                !selectedPatient ||
                !procedure.trim() ||
                !selectedRecordingFile ||
                busy
              }
            >
              <Radio size={16} />
              {recordingAction === "file"
                ? "Uploading selected conversation..."
                : "Upload selected conversation"}
            </button>
          </div>
          {encounter.recommendationQuestions?.length ? (
            <div className="recommendation-questions">
              <span className="section-label">Next questions</span>
              {encounter.recommendationQuestions.map(question => (
                <article key={question.id}>
                  <strong>{question.question}</strong>
                  <small>{question.reason}</small>
                </article>
              ))}
            </div>
          ) : null}
          <div className="second-opinion-actions">
            <button
              type="button"
              onClick={raiseSecondOpinion}
              disabled={busy || encounter.secondOpinionRequested}
            >
              <CircleAlert size={16} />
              {encounter.secondOpinionRequested
                ? "2nd opinion requested"
                : "Ask for 2nd opinion"}
            </button>
          </div>
        </section>

        <section className="case-header">
          <div>
            <div className="eyebrow">PAC / {encounter.patientReference}</div>
            <h1>Listen once. Verify precisely.</h1>
            <p>
              Every proposed fact stays connected to what the patient actually
              said. Unknown remains unknown until you confirm it.
            </p>
          </div>
          <dl className="case-facts">
            <div>
              <dt>Clinician-selected procedure</dt>
              <dd>{encounter.procedure}</dd>
            </div>
            <div>
              <dt>Language path</dt>
              <dd><Languages size={15} /> Hindi ↔ English</dd>
            </div>
            <div>
              <dt>Consent</dt>
              <dd><ShieldCheck size={15} /> Recorded</dd>
            </div>
          </dl>
        </section>

        <section className="workspace">
          <aside className="evidence-panel" aria-label="Encounter evidence">
            <div className="panel-heading">
              <div>
                <span className="section-label">Evidence rail</span>
                <h2>What was said</h2>
                {hasSyntheticProcessedRecording ? (
                  <p className="synthetic-evidence-note">
                    Synthetic demo recording - clinician review required
                  </p>
                ) : null}
              </div>
              <div className="recording-summary" aria-label="Encounter recordings">
                <span className="recording-pill">
                  <Mic2 size={13} />
                  {evidenceRecordingSummary?.label}
                </span>
                {evidenceRecordingSummary?.duration ? (
                  <span className="recording-duration">
                    {evidenceRecordingSummary.duration}
                  </span>
                ) : null}
              </div>
            </div>
            <SpeechCapture
              encounterId={encounter.id}
              onEncounter={updated => {
                setEncounter(updated);
                setSelectedField(updated.proposals.at(-1)?.id ?? null);
                setNotice(
                  "Live speech added as source-linked suggestions for review."
                );
              }}
            />
            <div className="evidence-list">
              {encounter.transcript.map(turn => (
                <EvidenceTurn
                  key={turn.id}
                  turn={turn}
                  active={sourceIds.has(turn.id)}
                />
              ))}
            </div>
            {hasSyntheticProcessedRecording ? (
              <div className="provider-evidence-label">
                Sarvam translated evidence
              </div>
            ) : null}
          </aside>

          <section className="pac-sheet" aria-label="PAC draft">
            <div className="sheet-heading">
              <div>
                <span className="section-label">Clinician-controlled draft</span>
                <h2>Pre-anesthetic check-up</h2>
              </div>
              <div className="completeness">
                <strong>
                  {displayedChecklist?.answeredCount ?? 0}/
                  {displayedChecklist?.applicableCount ?? 0}
                </strong>
                questions answered
              </div>
            </div>

            {displayedChecklist ? (
              <PacChecklist
                checklist={displayedChecklist}
                suggestions={encounter.checklistSuggestions}
                checklistLibrary={encounter.checklistLibrary}
                selectedItemId={selectedField}
                onSelectItem={itemId => {
                  setSelectedField(itemId);
                  setResolution("");
                }}
                onApproveSuggestion={suggestionId =>
                  void decideChecklistSuggestion(suggestionId, "approve")
                }
                onRejectSuggestion={suggestionId =>
                  void decideChecklistSuggestion(suggestionId, "reject")
                }
                onPublishSuggestions={() =>
                  void publishChecklistSuggestions()
                }
              />
            ) : null}

            {selectedChecklistItem &&
              ["uncertain", "missing", "clinician_required"].includes(
                selectedChecklistItem.status
              ) && (
              <div className="resolution-drawer">
                <div>
                  <span className="section-label">Raksha clarification</span>
                  <h3>{selectedChecklistItem.label}</h3>
                  <p>{selectedChecklistItem.question}</p>
                  {selectedChecklistItem.clarificationGuidance ? (
                    <p>{selectedChecklistItem.clarificationGuidance}</p>
                  ) : null}
                  {selectedChecklistItem.prohibition ? (
                    <p className="prohibition-note">
                      {selectedChecklistItem.prohibition}
                    </p>
                  ) : null}
                </div>
                <label>
                  Clinician-confirmed entry
                  <textarea
                    value={resolution}
                    onChange={event => setResolution(event.target.value)}
                    placeholder="Record only what you verified…"
                    rows={3}
                  />
                </label>
                <button
                  className="confirm-button"
                  type="button"
                  onClick={confirmSelectedField}
                  disabled={!resolution.trim() || busy}
                >
                  Confirm field <ArrowRight size={16} />
                </button>
                {selectedChecklistItem.deferrable ? (
                  <button
                    className="defer-button"
                    type="button"
                    onClick={deferSelectedChecklistItem}
                    disabled={!resolution.trim() || busy}
                  >
                    Defer with this reason
                  </button>
                ) : null}
              </div>
            )}

            {encounter.customerSummary && (
              <section
                className="customer-summary-drawer"
                aria-label="Customer summary drawer"
              >
                <div>
                  <span className="section-label">Customer summary</span>
                  <h3>Simple note for patient</h3>
                  <p>{encounter.customerSummary}</p>
                  {patientSummaryHandoff ? (
                    <div className="patient-language-output">
                      <strong>
                        {
                          patientSummaryLanguages.find(
                            language =>
                              language.code === patientSummaryHandoff.languageCode
                          )?.label
                        }{" "}
                        summary
                      </strong>
                      <p lang={patientSummaryHandoff.languageCode}>
                        {patientSummaryHandoff.translatedText}
                      </p>
                      <button
                        className="patient-audio-trigger"
                        type="button"
                        onClick={playPatientSummaryAudio}
                      >
                        <Volume2 size={16} />
                        {patientAudioStarted
                          ? "Replay patient audio"
                          : "Play patient audio"}
                      </button>
                      <audio
                        aria-label="Play patient summary audio"
                        controls
                        ref={patientAudioRef}
                        onPlay={() => setPatientAudioStarted(true)}
                        src={`data:${patientSummaryHandoff.audioMimeType};base64,${patientSummaryHandoff.audioBase64}`}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="summary-actions">
                  <label>
                    Patient language
                    <select
                      value={patientSummaryLanguage}
                      onChange={event => {
                        setPatientSummaryLanguage(
                          event.target.value as PatientSummaryLanguageCode
                        );
                        setPatientSummaryHandoff(null);
                        setPatientAudioStarted(false);
                      }}
                    >
                      {patientSummaryLanguages.map(language => (
                        <option key={language.code} value={language.code}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="handoff-button"
                    type="button"
                    onClick={generatePatientSummaryAudio}
                    disabled={busy}
                  >
                    <Volume2 size={16} />
                    Generate patient audio
                  </button>
                  <button
                    className="handoff-button secondary"
                    type="button"
                    onClick={mockEmailCustomerSummary}
                    disabled={summaryEmailSent}
                  >
                    {summaryEmailSent ? "Mock email sent" : "Mock email summary"}
                  </button>
                </div>
              </section>
            )}

            <footer className="sheet-footer">
              <div className="safety-note">
                <ShieldCheck size={18} />
                <span>
                  <strong>Clinician authority preserved</strong>
                  Vaanaya cannot diagnose, classify risk, or finalize this note.
                </span>
              </div>
              <div className="footer-actions">
                <button
                  className="print-button"
                  type="button"
                  onClick={() => window.print()}
                  aria-label="Print or save PDF"
                >
                  <Printer size={16} /> Print / PDF
                </button>
                <button
                  className="sign-button"
                  type="button"
                  onClick={signNote}
                  disabled={
                    displayedChecklist?.readyForSignoff !== true ||
                    busy ||
                    encounter.state === "signed"
                  }
                >
                  {encounter.state === "signed" ? (
                    <>
                      <FileCheck2 size={17} /> PAC note signed
                    </>
                  ) : (
                    <>
                      <Sparkles size={17} /> Sign PAC note
                    </>
                  )}
                </button>
              </div>
            </footer>
            {encounter.state === "signed" && (
              <section className="patient-handoff" aria-label="Kannada patient handoff">
                <div>
                  <span className="section-label">Patient handoff · Kannada</span>
                  {handoff ? (
                    <>
                      <p lang="kn">{handoff.translatedText}</p>
                      <audio
                        controls
                        src={`data:${handoff.audioMimeType};base64,${handoff.audioBase64}`}
                      />
                    </>
                  ) : (
                    <p>
                      Generate a generic, signed-status handoff. No medication
                      or fasting instruction is added automatically.
                    </p>
                  )}
                </div>
                {!handoff && (
                  <button
                    className="handoff-button"
                    type="button"
                    onClick={generateKannadaHandoff}
                    disabled={busy}
                  >
                    <Volume2 size={16} /> Generate Kannada
                  </button>
                )}
              </section>
            )}
            {notice && <div className="notice" role="status">{notice}</div>}
          </section>
        </section>
      </main>
    </div>
  );
}

function patientMatchesQuery(patient: PatientSummary, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return (
    patient.displayName.toLowerCase().includes(normalizedQuery) ||
    patient.mobileNumber.includes(normalizedQuery) ||
    patient.mobileLast4.includes(normalizedQuery)
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default App;
