import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  FileCheck2,
  Languages,
  Link2,
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
  FieldState,
  PatientSummary,
  TranscriptTurn
} from "@vaanaya/contracts";
import {
  createEncounterRequest,
  processCompleteExampleRecording,
  createKannadaHandoff,
  getEncounter,
  requestSecondOpinion,
  resolveField,
  searchPatients,
  signEncounterRequest,
  type KannadaHandoff
} from "./api";
import { SpeechCapture } from "./SpeechCapture";
import "./styles.css";

const statusLabels: Record<FieldState, string> = {
  captured: "Captured",
  uncertain: "Needs confirmation",
  missing: "Missing",
  intentionally_skipped: "Intentionally skipped",
  clinician_entered: "Clinician confirmed"
};

function formatOffset(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
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
        <p lang={turn.language}>{turn.original}</p>
        <p className="translation">{turn.translation}</p>
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
  const [recordingAction, setRecordingAction] = useState<"complete" | null>(null);
  const [handoff, setHandoff] = useState<KannadaHandoff | null>(null);
  const [conversationFilter, setConversationFilter] = useState<
    "all" | "second-opinion"
  >("all");

  useEffect(() => {
    let active = true;
    getEncounter("demo")
      .then(data => {
        if (!active) return;
        setEncounter(data);
        setSelectedField(data.proposals[0]?.id ?? null);
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
  const sourceIds = useMemo(
    () => new Set(selectedProposal?.sourceTurnIds ?? []),
    [selectedProposal]
  );
  const unresolvedRequired =
    encounter?.proposals.filter(
      proposal =>
        proposal.required &&
        ["uncertain", "missing"].includes(proposal.state)
    ) ?? [];
  const conversations = encounter ? [encounter] : [];
  const visibleConversations = conversations.filter(conversation =>
    conversationFilter === "second-opinion"
      ? conversation.secondOpinionRequested
      : true
  );
  const hasSyntheticProcessedRecording = Boolean(
    encounter?.audit.some(
      event =>
        event.action === "recording.synthetic_processed" &&
        event.detail.syntheticDemo === true
    )
  );

  async function confirmSelectedField() {
    if (!encounter || !selectedProposal || !resolution.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await resolveField(
        encounter.id,
        selectedProposal.id,
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
    setNotice(null);
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

  async function raiseSecondOpinion() {
    if (!encounter) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await requestSecondOpinion(encounter.id);
      setEncounter(updated);
      setConversationFilter("second-opinion");
      setNotice("2nd opinion requested. This PAC is now highlighted in listings.");
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

      <main>
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
                  <small>mobile ending {patient.mobileLast4}</small>
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

        <section className="conversation-listing" aria-label="PAC conversation listings">
          <div className="listing-header">
            <div>
              <span className="section-label">Conversation listings</span>
              <h2>PAC conversations</h2>
            </div>
            <div className="listing-filters" aria-label="Conversation filters">
              <button
                type="button"
                className={conversationFilter === "all" ? "is-active" : ""}
                onClick={() => setConversationFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={
                  conversationFilter === "second-opinion" ? "is-active" : ""
                }
                onClick={() => setConversationFilter("second-opinion")}
              >
                Needs 2nd opinion
              </button>
            </div>
          </div>
          <div className="conversation-cards">
            {visibleConversations.map(conversation => (
              <article
                key={conversation.id}
                className={
                  conversation.secondOpinionRequested
                    ? "conversation-card needs-second-opinion"
                    : "conversation-card"
                }
              >
                <div>
                  <strong>{conversation.patient?.displayName ?? conversation.patientReference}</strong>
                  <small>{conversation.procedure}</small>
                </div>
                {conversation.secondOpinionRequested ? (
                  <span className="second-opinion-badge">2nd opinion raised</span>
                ) : (
                  <span className="conversation-status">Standard review</span>
                )}
              </article>
            ))}
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
              <span className="recording-pill"><Mic2 size={13} /> 01:16</span>
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
                  {encounter.proposals.length - unresolvedRequired.length}/
                  {encounter.proposals.length}
                </strong>
                fields ready
              </div>
            </div>

            <div className="field-list">
              {encounter.proposals.map((proposal, index) => (
                <article
                  className={`pac-field ${
                    selectedField === proposal.id ? "is-selected" : ""
                  } ${proposal.state === "uncertain" ? "is-uncertain" : ""}`}
                  key={proposal.id}
                >
                  <button
                    className="field-main"
                    type="button"
                    onClick={() => setSelectedField(proposal.id)}
                  >
                    <span className="field-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="field-content">
                      <span className="field-title-row">
                        <strong>{proposal.label}</strong>
                        <span className={`field-status ${proposal.state}`}>
                          {proposal.state === "uncertain" ? (
                            <CircleAlert size={14} />
                          ) : (
                            <Check size={14} />
                          )}
                          {statusLabels[proposal.state]}
                        </span>
                      </span>
                      <span className="field-value">{proposal.value}</span>
                    </span>
                  </button>
                  <button
                    className="source-link"
                    type="button"
                    onClick={() => setSelectedField(proposal.id)}
                    aria-label={`View source for ${proposal.label}`}
                  >
                    <Link2 size={14} />
                    {proposal.sourceTurnIds.join(", ")}
                  </button>
                </article>
              ))}
            </div>

            {selectedProposal?.state === "uncertain" && (
              <div className="resolution-drawer">
                <div>
                  <span className="section-label">Raksha clarification</span>
                  <h3>Confirm the exact medicine</h3>
                  <p>
                    Ask for the strip or prescription. Do not infer aspirin,
                    clopidogrel, dose, or an instruction from “blood thinner.”
                  </p>
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
              </div>
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
                    unresolvedRequired.length > 0 ||
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

export default App;
