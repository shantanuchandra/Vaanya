import { type FormEvent, useEffect, useState } from "react";
import { Clock3, Save, TimerReset } from "lucide-react";
import {
  getTimingEvidence,
  saveTimingObservation,
  type TimingObservation,
  type TimingSummary
} from "./api";

const scenarios = [
  { id: "PAC-SYN-0005", label: "Unknown blood thinner" },
  { id: "PAC-SYN-0721", label: "Fasting correction" },
  { id: "PAC-SYN-0866", label: "Prior anesthesia recall" }
];

export function EvidencePage() {
  const [observations, setObservations] = useState<TimingObservation[]>([]);
  const [summary, setSummary] = useState<TimingSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const evidence = await getTimingEvidence();
    setObservations(evidence.observations);
    setSummary(evidence.summary);
  }

  useEffect(() => {
    refresh().catch(error =>
      setNotice(error instanceof Error ? error.message : "Evidence unavailable.")
    );
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, scenarioId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await saveTimingObservation({
        scenarioId,
        paperSeconds: Math.round(Number(data.get("paperMinutes")) * 60),
        vaanayaSeconds: Math.round(Number(data.get("vaanayaMinutes")) * 60),
        paperCorrections: Number(data.get("paperCorrections")),
        vaanayaCorrections: Number(data.get("vaanayaCorrections")),
        notes: String(data.get("notes") ?? "")
      });
      await refresh();
      setNotice(`${scenarioId} paired observation saved.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Save failed.");
    }
  }

  return (
    <div className="timing-shell">
      <header className="review-topbar">
        <a href="/" className="brand">
          <span className="brand-mark">V</span>
          <span><strong>Vaanaya</strong><small>Measured evidence</small></span>
        </a>
        <a className="review-link" href="/review">Clinical case review</a>
      </header>
      <main className="timing-main">
        <section className="timing-hero">
          <div>
            <span className="section-label">Paired workflow observation</span>
            <h1>Measure the minutes.<br />Earn the claim.</h1>
          </div>
          {summary ? (
            <div className="timing-claim">
              <strong>{summary.medianReductionPercent}%</strong>
              <span>observed median documentation-time reduction</span>
              <small>{summary.pairedObservations} paired synthetic scenarios</small>
            </div>
          ) : (
            <div className="timing-empty">
              <TimerReset size={24} />
              <strong>No measured time claim yet</strong>
              <span>Record paired observations below.</span>
            </div>
          )}
        </section>
        <p className="timing-boundary">
          Time the same scenario on paper and in Vaanaya. Enter only observed
          results; this page calculates the median and makes no efficacy claim.
        </p>
        <section className="timing-cards">
          {scenarios.map(scenario => {
            const saved = observations.find(item => item.scenarioId === scenario.id);
            return (
              <form key={scenario.id} onSubmit={event => save(event, scenario.id)}>
                <div className="timing-card-title">
                  <span>{scenario.id}</span>
                  <h2>{scenario.label}</h2>
                  {saved && <small>Last observed {new Date(saved.observedAt).toLocaleString()}</small>}
                </div>
                <div className="timing-pair">
                  <fieldset>
                    <legend>Paper workflow</legend>
                    <label>Minutes<input name="paperMinutes" type="number" min="0.1" max="120" step="0.1" defaultValue={saved ? saved.paperSeconds / 60 : ""} required /></label>
                    <label>Corrections<input name="paperCorrections" type="number" min="0" defaultValue={saved?.paperCorrections ?? 0} required /></label>
                  </fieldset>
                  <Clock3 size={18} />
                  <fieldset>
                    <legend>Vaanaya workflow</legend>
                    <label>Minutes<input name="vaanayaMinutes" type="number" min="0.1" max="120" step="0.1" defaultValue={saved ? saved.vaanayaSeconds / 60 : ""} required /></label>
                    <label>Corrections<input name="vaanayaCorrections" type="number" min="0" defaultValue={saved?.vaanayaCorrections ?? 0} required /></label>
                  </fieldset>
                </div>
                <label className="timing-notes">Observation notes<textarea name="notes" rows={2} defaultValue={saved?.notes ?? ""} placeholder="Who timed it, what interrupted the flow?" /></label>
                <button type="submit"><Save size={15} /> Save paired observation</button>
              </form>
            );
          })}
        </section>
        {notice && <div className="notice" role="status">{notice}</div>}
      </main>
    </div>
  );
}
