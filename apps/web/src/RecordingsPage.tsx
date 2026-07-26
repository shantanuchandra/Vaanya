import { FileAudio, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type {
  RecordingListItem,
  RecordingStatus
} from "@vaanaya/contracts";

type Props = {
  recordings: RecordingListItem[];
  loading: boolean;
  onOpen(encounterId: string): void;
  onProcess(encounterId: string): void;
};

const statusLabels: Record<RecordingStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  ready_for_review: "Ready for review",
  signed: "Signed",
  failed: "Failed"
};

function actionLabel(recording: RecordingListItem): string {
  if (recording.status === "uploaded") return "Process recording";
  if (recording.status === "failed") return "Retry";
  if (recording.status === "ready_for_review") return "Continue review";
  if (recording.status === "signed") return "View signed note";
  return recording.hasTranscript ? "Open evidence" : "Processing";
}

export function RecordingsPage({
  recordings,
  loading,
  onOpen,
  onProcess
}: Props) {
  const [filter, setFilter] = useState<"all" | "second-opinion">("all");
  const visibleRecordings = recordings.filter(recording =>
    filter === "second-opinion" ? recording.secondOpinionRequested : true
  );
  return (
    <main className="recordings-page">
      <div className="recordings-toolbar">
        <div>
          <span className="section-label">Clinician worklist</span>
          <h1>Conversation listings</h1>
          <p>Unprocessed PAC conversations are pinned first. Completed conversations follow newest-first.</p>
        </div>
        <div className="recordings-toolbar-actions">
          <div className="listing-filters" aria-label="Conversation filters">
            <button
              type="button"
              className={filter === "all" ? "is-active" : ""}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={filter === "second-opinion" ? "is-active" : ""}
              onClick={() => setFilter("second-opinion")}
            >
              Needs 2nd opinion
            </button>
          </div>
          <span className="synthetic-data-badge">
            <ShieldCheck size={15} />
            Synthetic demo data
          </span>
        </div>
      </div>

      {loading ? <p>Loading recordings…</p> : null}
      {!loading && visibleRecordings.length === 0 ? (
        <p>No conversations match this filter.</p>
      ) : null}

      <section className="recording-list" aria-label="PAC recordings">
        {visibleRecordings.map(recording => {
          const label = actionLabel(recording);
          const processAction = ["uploaded", "failed"].includes(
            recording.status
          );
          const disabled =
            recording.status === "processing" && !recording.hasTranscript;
          return (
            <article
              className={
                recording.secondOpinionRequested
                  ? "recording-list-item needs-second-opinion"
                  : "recording-list-item"
              }
              key={recording.encounterId}
            >
              <div className="recording-patient">
                <FileAudio size={19} />
                <div>
                  <strong>{recording.patient.displayName}</strong>
                  <small>
                    Synthetic
                    {recording.patient.sex
                      ? ` · ${recording.patient.sex.charAt(0).toUpperCase()}${recording.patient.sex.slice(1)}`
                      : ""}
                    {" · "}mobile ending {recording.patient.mobileLast4}
                  </small>
                </div>
              </div>
              <div className="recording-details">
                <strong>{recording.procedure}</strong>
                <small>
                  {recording.preferredLanguage} ·{" "}
                  {new Date(recording.recordedAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short"
                  })}
                </small>
              </div>
              <div className="recording-metrics">
                <span>{recording.answeredCount} of {recording.applicableCount} answered</span>
                <span>{recording.criticalGapCount} critical gaps</span>
              </div>
              <span className={`recording-status recording-status-${recording.status}`}>
                {statusLabels[recording.status]}
              </span>
              {recording.secondOpinionRequested ? (
                <span className="second-opinion-badge">2nd opinion raised</span>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                aria-label={`${label} for ${recording.patient.displayName}`}
                onClick={() =>
                  processAction
                    ? onProcess(recording.encounterId)
                    : onOpen(recording.encounterId)
                }
              >
                {label}
              </button>
            </article>
          );
        })}
      </section>
    </main>
  );
}
