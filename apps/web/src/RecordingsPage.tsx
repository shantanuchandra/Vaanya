import { FileAudio, ShieldCheck } from "lucide-react";
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
  return (
    <main className="recordings-page">
      <div className="recordings-toolbar">
        <div>
          <span className="section-label">Clinician worklist</span>
          <h1>Recordings</h1>
          <p>Unprocessed recordings are pinned first. Completed recordings follow newest-first.</p>
        </div>
        <span className="synthetic-data-badge">
          <ShieldCheck size={15} />
          Synthetic demo data
        </span>
      </div>

      {loading ? <p>Loading recordings…</p> : null}
      {!loading && recordings.length === 0 ? (
        <p>No recordings are available.</p>
      ) : null}

      <section className="recording-list" aria-label="PAC recordings">
        {recordings.map(recording => {
          const label = actionLabel(recording);
          const processAction = ["uploaded", "failed"].includes(
            recording.status
          );
          const disabled =
            recording.status === "processing" && !recording.hasTranscript;
          return (
            <article className="recording-list-item" key={recording.encounterId}>
              <div className="recording-patient">
                <FileAudio size={19} />
                <div>
                  <strong>{recording.patient.displayName}</strong>
                  <small>
                    Synthetic · mobile ending {recording.patient.mobileLast4}
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
