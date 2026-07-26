import { useRef, useState } from "react";
import { CircleStop, LoaderCircle, Mic2, ShieldCheck } from "lucide-react";
import {
  transcribeEncounterSpeech,
  type TranscriptionResult
} from "./api";
import type { Encounter } from "@vaanaya/contracts";

type CaptureState = "idle" | "recording" | "transcribing" | "complete";

export function SpeechCapture({
  encounterId,
  onEncounter
}: {
  encounterId: string;
  onEncounter: (encounter: Encounter) => void;
}) {
  const [state, setState] = useState<CaptureState>("idle");
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function startRecording() {
    setError(null);
    setResult(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error("Microphone recording is not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const nextRecorder = new MediaRecorder(stream);
      chunks.current = [];
      nextRecorder.addEventListener("dataavailable", event => {
        if (event.data.size) chunks.current.push(event.data);
      });
      nextRecorder.addEventListener("stop", async () => {
        stream.getTracks().forEach(track => track.stop());
        setState("transcribing");
        try {
          const audio = new Blob(chunks.current, {
            type: nextRecorder.mimeType || "audio/webm"
          });
          const extracted = await transcribeEncounterSpeech(
            encounterId,
            audio,
            "hi-IN"
          );
          setResult(extracted.transcription);
          onEncounter(extracted.encounter);
          setState("complete");
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Transcription failed."
          );
          setState("idle");
        }
      });
      recorder.current = nextRecorder;
      nextRecorder.start();
      setState("recording");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Microphone access failed."
      );
      setState("idle");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
  }

  return (
    <section className={`speech-capture is-${state}`} aria-label="Live speech capture">
      <div className="capture-heading">
        <span className="section-label">Live Sarvam capture</span>
        <span className="capture-privacy">
          <ShieldCheck size={12} /> consented encounter
        </span>
      </div>
      {result ? (
        <div className="capture-result">
          <p lang={result.languageCode ?? "hi-IN"}>{result.transcript}</p>
          <span>
            {result.languageCode ?? "language unknown"}
            {result.languageProbability !== null &&
              ` · ${Math.round(result.languageProbability * 100)}% language confidence`}
          </span>
        </div>
      ) : (
        <p className="capture-prompt">
          Capture one patient answer. Sarvam creates source-linked suggestions;
          they remain review-only until a clinician confirms them.
        </p>
      )}
      <button
        className="capture-button"
        type="button"
        onClick={state === "recording" ? stopRecording : startRecording}
        disabled={state === "transcribing"}
      >
        {state === "recording" && <CircleStop size={15} />}
        {state === "transcribing" && <LoaderCircle className="spin" size={15} />}
        {(state === "idle" || state === "complete") && <Mic2 size={15} />}
        {state === "recording"
          ? "Stop & transcribe"
          : state === "transcribing"
            ? "Transcribing…"
            : result
              ? "Record again"
              : "Record patient"}
      </button>
      {error && <p className="capture-error" role="alert">{error}</p>}
    </section>
  );
}
