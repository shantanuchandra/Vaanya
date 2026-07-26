import { useEffect, useState } from "react";
import type { RecordingListItem } from "@vaanaya/contracts";
import {
  getRecordings,
  processCompleteExampleRecording
} from "./api";
import { RecordingsPage } from "./RecordingsPage";
import "./styles.css";

export function RecordingsRoute() {
  const [recordings, setRecordings] = useState<RecordingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getRecordings()
      .then(items => {
        if (active) setRecordings(items);
      })
      .catch(error => {
        if (active)
          setNotice(
            error instanceof Error ? error.message : "Recordings unavailable."
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function processRecording(encounterId: string) {
    setLoading(true);
    setNotice(null);
    try {
      await processCompleteExampleRecording(encounterId);
      window.location.assign(`/?encounter=${encodeURIComponent(encounterId)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recording failed.");
      setLoading(false);
    }
  }

  function openRecording(encounterId: string) {
    window.location.assign(`/?encounter=${encodeURIComponent(encounterId)}`);
  }

  return (
    <>
      <RecordingsPage
        recordings={recordings}
        loading={loading}
        onOpen={openRecording}
        onProcess={processRecording}
      />
      {notice && (
        <div className="notice recordings-notice" role="status">
          {notice}
        </div>
      )}
    </>
  );
}
